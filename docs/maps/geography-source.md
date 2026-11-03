# 地理数据来源

使用 Natural Earth 1:110m 公共领域数据，仅在生成地图时读取；客户端运行时不加载原始 GeoJSON。

- 海岸线：ne_110m_land.geojson。
- 东亚国界：ne_110m_admin_0_countries.geojson 中 CHN、TWN、KOR、PRK、JPN 五个轮廓，摘录为 ne_110m_east_asia.geojson。朝鲜半岛并入北京战区，台湾完整并入中国南方战区，南北分界为北纬34度。
- 主要河流：ne_110m_rivers_lake_centerlines.geojson，保留13条主要河流。
- 湖泊：ne_110m_lakes.geojson，保留24个主要湖泊。
- 山地、沙漠、高原、平原、苔原：ne_110m_geography_regions_polys.geojson，保留22个主要地理区域。

原始数据：https://github.com/nvkelso/natural-earth-vector/tree/master/geojson

使用条款：https://www.naturalearthdata.com/about/terms-of-use/

局地战生成说明见 ../../docs/campaign-regional-geography.md。
