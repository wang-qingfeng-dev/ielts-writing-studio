export const DEMO_PROMPT = `Some people think that governments should spend more money on public transport rather than building new roads.

To what extent do you agree or disagree?

Give reasons for your answer and include any relevant examples from your own knowledge or experience. Write at least 250 words.`;

export const DEMO_ESSAY = `In many cities, traffic congestion has become a serious problem. Some people believes that governments should spend more money on public transport instead of building new roads. I agree that buses and trains deserve more support, although some road construction is still necessary.

One important reason is that public transport can move many passengers at the same time. If a city provides frequent buses, there will be less cars on its main streets. This make daily journeys faster for everyone, including people who still need to drive. For example, workers could leave their cars at home when there is a bus stop near their office. However, many people depend of cars because buses are often late or crowded. Governments should therefore invest to better services before asking residents to change their habits.

Another benefit is that a reliable buses can help people with limited incomes. Travelling by bus is more cheaper than buying a car and paying for petrol. Students and older residents may also find it easier to reach schools, hospitals and shops. These changes can brings more opportunities to people who live far from the city centre. Nevertheless, roads should not be ignored completely. In some new neighbourhoods, the existing road network is too small, and emergency vehicles may struggle to pass. Such roads should be improve, but this does not mean every traffic problem requires another large motorway.

In conclusion, public transport should recieve a larger share of government funding because it reduces traffic and makes travel more affordable. Road projects are still useful in specific places, but they should support a balanced transport system.`;

const correctedText = `In many cities, traffic congestion has become a serious problem. Some people believe that governments should spend more money on public transport instead of building new roads. I agree that buses and trains deserve more support, although some road construction is still necessary.

One important reason is that public transport can move many passengers at the same time. If a city provides frequent buses, there will be fewer cars on its main streets. This makes daily journeys faster for everyone, including people who still need to drive. For example, workers could leave their cars at home when there is a bus stop near their office. However, many people depend on cars because buses are often late or crowded. Governments should therefore invest in better services before asking residents to change their habits.

Another benefit is that reliable buses can help people with limited incomes. Travelling by bus is cheaper than buying a car and paying for petrol. Students and older residents may also find it easier to reach schools, hospitals and shops. These changes can bring more opportunities to people who live far from the city centre. Nevertheless, roads should not be ignored completely. In some new neighbourhoods, the existing road network is too small, and emergency vehicles may struggle to pass. Such roads should be improved, but this does not mean every traffic problem requires another large motorway.

In conclusion, public transport should receive a larger share of government funding because it reduces traffic and makes travel more affordable. Road projects are still useful in specific places, but they should support a balanced transport system.`;

const modelText = `Transport budgets are limited, so governments must decide which investments will deliver the greatest public benefit. I largely agree that improving public transport should take priority over constructing new roads, particularly in densely populated cities. However, the appropriate balance depends on local conditions.

The strongest argument for this priority is that expanding road capacity rarely provides a lasting solution to urban congestion. When driving becomes easier, some commuters who previously travelled at different times or used other modes switch to their cars. This process, often described as induced demand, can gradually erode the initial benefits of a new road. A bus lane or a well-connected rail service, by contrast, allows more people to travel within a limited amount of street space. If services are frequent and dependable, they offer a practical alternative to driving, rather than merely asking residents to tolerate a less convenient journey.

Public transport investment can also widen access to employment. A person without a car may be unable to accept a job if the workplace is poorly served by buses, especially when shifts begin early or end late. Extending operating hours can therefore be as valuable as constructing an impressive new station. Nevertheless, this does not justify abandoning road investment everywhere. In rural areas, where passengers are dispersed, a comprehensive rail network may be prohibitively expensive. Maintaining essential routes and making targeted road improvements can be a more sensible use of public funds there.

Overall, governments should give public transport a larger share of investment in places where it can serve substantial numbers of people. New roads should be approved when they address a clearly identified need, with their long-term effects assessed alongside the benefits of better bus and rail services.`;

export const DEMO_ANALYSIS = {
  originalScore: {
    low: 5.5,
    high: 6.5,
    criteria: [
      {
        key: 'TR', band: 6,
        evidence: '明确支持优先投入公共交通，也承认修路的必要性；减轻拥堵与出行可负担性均与题目相关。不过，“车站靠近办公室”还不足以解释司机何时会真正改乘公交，反方条件展开较短。',
        action: '补一层因果：班次与可靠性如何改变通勤选择，再说明哪些道路项目仍值得投入。'
      },
      {
        key: 'CC', band: 6.5,
        evidence: '四段结构清楚，观点整体递进。第三段先谈低收入群体，再转入修路例外，承担两个功能，段落重心略分散。',
        action: '将修路例外单独成段；让每个主体段围绕一个中心判断展开。'
      },
      {
        key: 'LR', band: 6,
        evidence: '能使用 traffic congestion、limited incomes 和 emergency vehicles 等主题词；depend of 与 invest to 的搭配不准确，recieve 存在拼写错误。',
        action: '先稳定掌握 depend on、invest in 这类常用动词搭配，再用新句检验是否能主动运用。'
      },
      {
        key: 'GRA', band: 5.5,
        evidence: '尝试条件句、让步从句与定语从句，意思基本清楚；people believes、This make、can brings 和 should be improve 显示基础结构的准确性不稳定。',
        action: '优先检查主谓一致，以及情态动词后接原形、被动结构中的过去分词。'
      }
    ]
  },
  corrected: {
    text: correctedText,
    score: {
      low: 6,
      high: 7,
      criteria: [
        {
          key: 'TR', band: 6,
          evidence: '修订保留原有立场与论据，任务回应的深度没有因纠正语法而自动提高；公交服务与减少拥堵之间仍可增加条件说明。',
          action: '解释“班次准时且换乘方便 → 通勤者愿意改乘 → 高峰车流减少”，让推理更完整。'
        },
        {
          key: 'CC', band: 6.5,
          evidence: '原有段落与衔接保持不变，阅读更顺畅，但第三段仍同时承担可负担性论证和修路例外两种功能。',
          action: '在正式重写时拆分段落，并用一句话明确例外成立的条件。'
        },
        {
          key: 'LR', band: 6.5,
          evidence: '动词介词搭配和拼写得到修正，词汇使用更准确；表达仍以熟悉的交通词汇为主，部分内容使用较笼统的 more opportunities。',
          action: '把笼统的 opportunities 具体化为获得工作、就医或教育的机会，根据论证选择表达。'
        },
        {
          key: 'GRA', band: 7,
          evidence: '本篇修订后基础错误已消除，条件句、让步从句、定语从句和被动句均较准确。这里评估的是修订文本，不能据此认定独立写作能力已达到同一水平。',
          action: '不看修订稿重写三句，再在下一篇限时作文里检查相同规则能否保持准确。'
        }
      ]
    }
  },
  model: {
    text: modelText,
    score: {
      low: 7,
      high: 7.5,
      criteria: [
        {
          key: 'TR', band: 7.5,
          evidence: '立场贯穿全文，以新增道路可能诱发需求和改善就业可达性展开论证，并用农村地区的条件限制结论。第二个主体段涵盖两个层面，仍有进一步细化空间。',
          action: '学习“明确立场 → 解释机制 → 给出条件或例外”的展开方式，不依赖背诵全文。'
        },
        {
          key: 'CC', band: 7.5,
          evidence: '从道路扩建的局限推进到公共交通的社会价值，再处理地区差异；指代 This process 与条件连接自然，论证容易跟随。',
          action: '复述每段在回答什么问题，检查自己的段落是否也承担清晰的功能。'
        },
        {
          key: 'LR', band: 7.5,
          evidence: 'road capacity、induced demand、operating hours 等表达贴合具体论点；用词较准确，较少为了复杂而选择生僻词。',
          action: '选择两组能迁移到下一道题的搭配，记录适用情境并各造一句。'
        },
        {
          key: 'GRA', band: 7.5,
          evidence: '条件句、定语从句和非谓语结构交替使用，复杂关系表达清楚，未见明显语法错误；单篇示例不足以证明考场中的稳定表现。',
          action: '仿写一个 if 条件句和一个 where 定语从句，先保证准确，再增加复杂度。'
        }
      ]
    },
    notes: [
      {
        quote: 'I largely agree that improving public transport should take priority over constructing new roads, particularly in densely populated cities.',
        label: '立场加适用范围',
        explanation: '直接回答赞同程度，并用人口密集的城市限定立场，给后文讨论地区差异留下空间。'
      },
      {
        quote: 'When driving becomes easier, some commuters who previously travelled at different times or used other modes switch to their cars.',
        label: '解释现象背后的机制',
        explanation: '说明道路扩建为什么未必长期缓解拥堵，用行为变化补足原因与结果之间的推理。'
      },
      {
        quote: 'Extending operating hours can therefore be as valuable as constructing an impressive new station.',
        label: '把观点落实到具体措施',
        explanation: '从就业可达性推出延长运营时间这一措施，例子直接支持论点，无需编造统计数据。'
      },
      {
        quote: 'In rural areas, where passengers are dispersed, a comprehensive rail network may be prohibitively expensive.',
        label: '有条件地承认例外',
        explanation: '给出人口分散与成本之间的联系，说明农村地区可能需要不同的预算选择。'
      }
    ]
  },
  issues: [
    {
      id: 'subject-people', category: 'grammar',
      original: 'Some people believes', replacement: 'Some people believe',
      explanation: 'people 表示复数。一般现在时中，复数主语后的实义动词用原形 believe，不加 -s。',
      priority: 'essential',
      practice: {question: 'Complete: Many residents ___ (prefer) a direct bus to the city centre.', answer: 'prefer'}
    },
    {
      id: 'countable-fewer', category: 'grammar',
      original: 'less cars', replacement: 'fewer cars',
      explanation: 'cars 是可数名词复数，正式写作中用 fewer；less 常修饰不可数名词，例如 less traffic。',
      priority: 'essential',
      practice: {question: 'Complete: Better buses could mean ___ cars on the road. (less / fewer)', answer: 'fewer'}
    },
    {
      id: 'subject-this', category: 'grammar',
      original: 'This make', replacement: 'This makes',
      explanation: 'This 在这里指代前一句描述的情况，作单数主语；一般现在时中的谓语要用 makes。',
      priority: 'essential',
      practice: {question: 'Complete: A reliable train service ___ (make) commuting easier.', answer: 'makes'}
    },
    {
      id: 'depend-on', category: 'vocabulary',
      original: 'depend of cars', replacement: 'depend on cars',
      explanation: '表示“依赖某物”时，常用搭配是 depend on something。把动词与介词作为一组记忆。',
      priority: 'essential',
      practice: {question: 'Complete: Many rural residents depend ___ their cars.', answer: 'on'}
    },
    {
      id: 'invest-in', category: 'vocabulary',
      original: 'invest to better services', replacement: 'invest in better services',
      explanation: 'invest in + 名词表示“投资于”。to 可以引出目的，例如 invest more to improve services，但不能在这里直接连接名词。',
      priority: 'essential',
      practice: {question: 'Complete: Local authorities should invest ___ cleaner buses.', answer: 'in'}
    },
    {
      id: 'plural-article', category: 'grammar',
      original: 'a reliable buses', replacement: 'reliable buses',
      explanation: '不定冠词 a 不能修饰复数 buses。这里泛指可靠的公交车，用零冠词的复数形式。',
      priority: 'essential',
      practice: {question: 'Rewrite the noun phrase correctly: a frequent trains', answer: 'frequent trains'}
    },
    {
      id: 'double-comparative', category: 'grammar',
      original: 'more cheaper than', replacement: 'cheaper than',
      explanation: 'cheap 的比较级是 cheaper，已经包含“更”的意思，前面无需再加 more。',
      priority: 'essential',
      practice: {question: 'Complete: A monthly pass is ___ (cheap) than buying tickets every day.', answer: 'cheaper'}
    },
    {
      id: 'modal-base', category: 'grammar',
      original: 'can brings', replacement: 'can bring',
      explanation: '情态动词 can 后接动词原形，无论主语单复数，都用 can bring。',
      priority: 'essential',
      practice: {question: 'Complete: Better transport can ___ (reduce) travel costs.', answer: 'reduce'}
    },
    {
      id: 'passive-participle', category: 'grammar',
      original: 'should be improve', replacement: 'should be improved',
      explanation: '道路是被改善的对象，使用被动语态：should + be + 过去分词 improved。',
      priority: 'essential',
      practice: {question: 'Complete: These routes should be ___ (maintain) regularly.', answer: 'maintained'}
    },
    {
      id: 'receive-spelling', category: 'spelling',
      original: 'should recieve', replacement: 'should receive',
      explanation: 'receive 的正确拼写是 r-e-c-e-i-v-e。可将 receive 与 receiving 放在一起复习。',
      priority: 'essential',
      practice: {question: 'Correct the spelling: recieve', answer: 'receive'}
    }
  ],
  expressions: [
    {
      id: 'frequent-services', text: 'frequent buses', meaning: '班次密集的公交车',
      example: 'Frequent buses make it easier for commuters to leave their cars at home.',
      source: 'corrected', usage: '用于交通服务；frequent 描述班次频率，也可搭配 trains 或 services。'
    },
    {
      id: 'limited-incomes', text: 'with limited incomes', meaning: '收入有限的',
      example: 'Affordable fares are particularly important for families with limited incomes.',
      source: 'corrected', usage: '用于讨论可负担性与公平；放在 people、families 等名词后补充说明。'
    },
    {
      id: 'balanced-system', text: 'a balanced transport system', meaning: '兼顾不同需求的交通体系',
      example: 'A balanced transport system should accommodate buses, bicycles and essential car journeys.',
      source: 'corrected', usage: '适合提出综合方案；随后交代具体兼顾哪些需求，避免停留在笼统口号。'
    },
    {
      id: 'induced-demand', text: 'induced demand', meaning: '由新增供给刺激出来的需求',
      example: 'Induced demand can reduce the long-term benefits of expanding busy roads.',
      source: 'model', usage: '可用于解释扩路后的交通反弹；只有理解机制时才使用，并用普通语言加以说明。'
    },
    {
      id: 'employment-access', text: 'access to employment', meaning: '获得就业机会的渠道与条件',
      example: 'Reliable evening buses can improve access to employment for shift workers.',
      source: 'model', usage: '用于交通、教育和社会公平话题；常与 improve、widen 或 limit 搭配。'
    },
    {
      id: 'targeted-improvements', text: 'targeted road improvements', meaning: '针对具体问题的道路改进',
      example: 'Targeted road improvements could make dangerous rural junctions safer.',
      source: 'model', usage: '用于预算取舍；说明所针对的具体瓶颈、安全问题或服务需求。'
    }
  ],
  priorities: [
    {
      title: '先稳住基础句型',
      description: '本篇优先练主谓一致、情态动词与被动语态。关闭修订稿，独立完成对应练习，再用每种结构各写一句。'
    },
    {
      title: '把理由推进一层',
      description: '给“公交更好就会减少汽车”补上通勤者改变选择的条件：准时、班次足够、换乘方便。解释条件如何带来结果。'
    },
    {
      title: '分清段落职责并迁移',
      description: '重写时把修路例外独立成段；下一篇交通类作文主动使用两个搭配，并复查本篇出现过的三类基础语法。'
    }
  ]
};
