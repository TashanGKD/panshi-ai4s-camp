export interface HomeFixture {
  title: string; dates: string; venue: string; tagline: string
  intro: readonly string[]; target: string
  features: readonly { title: string; description: string }[]
  overview: readonly string[]
  organizations: readonly { role: string; name: string }[]
  importantDates: readonly { label: string; value: string }[]
  contact: string
}

// Task 6 replaces this isolated fixture with published API content.
export const homeFixture: HomeFixture = {
  title: '磐石·科学智能（AI for Science）实训营',
  dates: '2026-08-23 至 2026-08-27',
  venue: '中国科学院物理研究所',
  tagline: '面向科研实践的五日科学智能集中实训',
  intro: [
    '本次实训营围绕科学智能的基础方法与科研实践展开，通过课程、案例和动手环节，帮助参与者形成从问题理解到实践验证的完整认识。',
    '当前页面内容为稳定展示用 fixture，后续将由已发布的数据接口替换。',
  ],
  target: '面向希望了解并实践 AI for Science 方法的青年科研人员与学生。',
  features: [
    { title: '问题导向', description: '从真实科研问题出发，理解科学智能方法的适用边界。' },
    { title: '讲练结合', description: '以基础讲解、案例拆解和实践练习组织学习过程。' },
    { title: '集中交流', description: '在连续五天的共同学习中讨论方法、工具与研究思路。' },
  ],
  overview: ['第一天：基础与问题定义', '第二天：数据与表示', '第三天：模型与推断', '第四天：科研案例实践', '第五天：成果交流与总结'],
  organizations: [
    { role: '组织信息', name: '详细组织单位待正式发布' },
  ],
  importantDates: [
    { label: '报名开放', value: '待公布' },
    { label: '报名截止', value: '日期待公布' },
  ],
  contact: '联系方式待公布',
}
