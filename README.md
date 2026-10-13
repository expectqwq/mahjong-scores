# 304 麻将积分查询

通过 GitHub Pages 发布的只读查询前端，自动加载 `data.json`。

- 所有学期排行榜沿用换学期积分减半规则；单学期仅累计该学期得分。
- 两两同桌分数差为所有同桌对局的 `Σ(A.finalScore - B.finalScore)`，包含顺位分，不因换学期减半。
- 保留历史对局和学期奖项；访客无数据录入、导入、结算或保存入口。

## 更新数据

仓库所有者在本地计分器录入并导出 JSON 后，用导出文件替换 `data.json`，提交并通过 SSH 推送到 `main`。GitHub Pages 会更新站点。`data.json` 保留完整的 `records` 和学期切换记录，页面从记录重新计算统计。

## 本地预览

在仓库目录运行 `python3 -m http.server 8765`，然后访问 `http://localhost:8765`。
