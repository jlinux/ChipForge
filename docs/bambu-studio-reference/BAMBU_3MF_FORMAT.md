# Bambu Studio 3MF 文件格式参考

基于 BambuStudio 源码 `src/libslic3r/Format/bbs_3mf.cpp` 分析。

## 1. 核心文件结构

3MF 是 ZIP 文件，内含：

```
[Content_Types].xml          # OPC 内容类型声明
_rels/.rels                  # 关系文件，指向 3dmodel.model
3D/3dmodel.model             # 几何体 + 元数据（XML）
Metadata/model_settings.config  # BBS 专有：每个部件的挤出机/参数配置
```

## 2. BBS 识别机制

BambuStudio 通过 `<metadata name="Application">` 判断是否为自家格式：

```cpp
// bbs_3mf.cpp:3991
if (boost::starts_with(m_curr_characters, "BambuStudio-")) {
    m_is_bbl_3mf = true;
    m_bambuslicer_generator_version = Semver::parse(m_curr_characters.substr(12));
}
```

**关键约束：**
- `Application` 内容必须以 `"BambuStudio-"` 开头
- 后面的版本号必须是合法的 Semver（如 `1.9.5.52`），否则 `dont_load_config = true`
- 必须是元素文本内容，不是属性：`<metadata name="Application">BambuStudio-1.9.5.52</metadata>`

另外，`BambuStudio:3mfVersion` 设版本号（当前为 `1`）。

## 3. model_settings.config 格式

这是 BBS 专有的配置文件，**不是**标准 3MF 规范的一部分。

**文件路径常量：**
```cpp
// bbs_3mf.cpp:171
const std::string BBS_MODEL_CONFIG_FILE = "Metadata/model_settings.config";
// 注意: Slic3r_PE_model.config 已注释掉，不再使用
```

**XML 格式：**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<config>
  <object id="PARENT_OBJECT_ID">
    <metadata key="name" value="对象名"/>
    <metadata key="extruder" value="1"/>

    <part id="CHILD_OBJECT_ID_1" subtype="normal_part">
      <metadata key="name" value="部件名"/>
      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>
      <metadata key="extruder" value="1"/>
      <mesh_stat edges_fixed="0" degenerate_facets="0" facets_removed="0"
                 facets_reversed="0" backwards_edges="0"/>
    </part>

    <part id="CHILD_OBJECT_ID_2" subtype="normal_part">
      <metadata key="extruder" value="2"/>
      ...
    </part>
  </object>

  <plate>
    <metadata key="plater_id" value="1"/>
    <metadata key="locked" value="false"/>
  </plate>
</config>
```

**ID 映射关系：**
- `<object id="X">` 中的 X = 3dmodel.model 里**父对象**（含 `<components>`）的 id
- `<part id="Y">` 中的 Y = 3dmodel.model 里**子对象**（含 `<mesh>`）的 id
- `subtype` 可选值：`normal_part`, `negative_part`, `modifier_part`, `support_enforcer`, `support_blocker`

## 4. 3dmodel.model 格式

```xml
<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US"
  xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
  xmlns:BambuStudio="http://schemas.bambulab.com/package/2021">

 <metadata name="Application">BambuStudio-1.9.5.52</metadata>
 <metadata name="BambuStudio:3mfVersion">1</metadata>

 <resources>
    <!-- 可选：标准 3MF basematerials（作为非 BBS 切片器的回退方案） -->
    <basematerials id="100">
      <base name="Part1" displaycolor="#FF0000" />
      <base name="Part2" displaycolor="#00FF00" />
    </basematerials>

    <!-- 子对象（各含独立 mesh） -->
    <object id="1" type="model" pid="100" pindex="0">
      <mesh>
        <vertices>...</vertices>
        <triangles>...</triangles>
      </mesh>
    </object>
    <object id="2" type="model" pid="100" pindex="1">
      <mesh>...</mesh>
    </object>

    <!-- 父对象（通过 components 引用子对象） -->
    <object id="3" type="model">
      <components>
        <component objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0" />
        <component objectid="2" transform="1 0 0 0 1 0 0 0 1 0 0 0" />
      </components>
    </object>
  </resources>

  <build>
    <item objectid="3" />
  </build>
</model>
```

## 5. 颜色分配机制

### BBS 路径（m_is_bbl_3mf = true）
1. 读 `model_settings.config`，匹配 `<object id>` 到父对象
2. 每个 `<part>` 的 `extruder` metadata 设置该部件使用的耗材槽（1-based）
3. 在 `_generate_volumes_new()` 中通过 `volume->config.set_deserialize("extruder", ...)` 应用

### 通用 3MF 路径（m_is_bbl_3mf = false）
1. 读 `<basematerials>` 和 `<colorgroup>` 中的颜色
2. 每个 `<object>` 的 `pid`/`pindex` 指向颜色组中的条目
3. 相同颜色映射到同一 extruder ID，不同颜色映射到不同 extruder
4. **注意：** 此路径只设置 OBJECT 级别的 extruder，不支持 per-volume

### extruder 溢出保护
```cpp
// bbs_3mf.cpp:2222
if (extruder_id == 0 || extruder_id > max_filament_id)
    mo->config.set_key_value("extruder", new ConfigOptionInt(1));
```
如果用户的打印机配置只有 1 个耗材，所有 extruder > 1 的部件会被重置为 1。

## 6. 关键源码位置（行号参考）

| 功能 | 行号 | 函数 |
|------|------|------|
| BBS 文件识别 | 3991 | `_handle_end_metadata()` |
| config 文件加载 | 1546 | 主循环中 `iequals(name, BBS_MODEL_CONFIG_FILE)` |
| config object 解析 | 4234 | `_handle_start_config_object()` |
| config part 解析 | 4259 | `_handle_start_config_volume()` |
| config metadata 解析 | 4322 | `_handle_start_config_metadata()` |
| 组件列表生成 | 4852 | `_generate_current_object_list()` |
| 体积生成 + metadata 应用 | 4879 | `_generate_volumes_new()` |
| extruder metadata 反序列化 | 5110 | `volume->config.set_deserialize(...)` |
| extruder 溢出保护 | 2215 | 主循环结尾 |
| 颜色组处理（通用路径） | 2017 | `color_group_index_to_extruder_id_map` |
| model XML 写入 | 6802 | `_add_model_file_to_archive()` |
| config 写入 | 7805 | `_add_model_config_file_to_archive()` |

## 7. 常见问题

### 非流形边
多色打印中，部件重叠（overlap）会导致非流形边。这是正常的，切片器会自动处理布尔运算。使用 ~0.2mm 重叠比使用间隙（gap）更好。

### 颜色不显示
- 检查 `Application` metadata 是否以 `"BambuStudio-"` 开头
- 检查版本号是否为合法 Semver
- 检查 `model_settings.config` 的 `<part id>` 是否与 `3dmodel.model` 子对象 id 一致
- 检查用户 Bambu Studio 中是否配置了足够数量的耗材槽

### dont_load_config
如果 Semver 解析失败，`dont_load_config = true`。但这**不影响** `model_settings.config` 的加载（它不受此标志保护）。
