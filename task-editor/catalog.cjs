// Planning markers only. They are not the in-game accepted/ready/claimed states.
module.exports = [
  { id: "无需调整", color: "#7093a8", description: "作为背景和依赖参考，不修改该委托的实现。" },
  { id: "需要调整", color: "#e3b956", description: "按策划文本新增或调整该委托的实现。" },
  {
    id: "有变动",
    color: "#65c9e3",
    description: "策划内容已更新，结合委托系统版本号核对差异并同步实现。",
  },
  {
    id: "废弃",
    color: "#d97b8b",
    description: "该委托不再使用。保留策划记录，AI处理移除或停用及相关前置引用。",
  },
];
