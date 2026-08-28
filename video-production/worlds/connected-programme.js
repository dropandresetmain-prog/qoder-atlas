(() => {
  const NS = window.NS = window.NS || {};
  const outcomes = {
    4:['green','✓'],9:['brass','▲'],12:['red','✕'],18:['green','✓'],23:['brass','▲'],31:['red','✕'],
    37:['green','✓'],44:['green','✓'],52:['brass','▲'],59:['green','✓'],65:['brass','▲']
  };
  NS.CONNECTED_PROGRAMME = Object.freeze({
    world:{width:8300,height:4300},
    cameras:{
      seq04Final:{x:-12,y:-24,scale:.33},
      whole:{x:27,y:56,scale:.225},
      hero17:{x:-1765,y:-90,scale:.43},
      hero31:{x:-1450,y:-430,scale:.40},
      hero65:{x:-1450,y:-955,scale:.40}
    },
    scaleField:{
      count:72, heroId:17, cols:[640,1500,2360,3220,4080,4940], rowStart:690,rowStep:215,
      outcomes,
      representativeSupplier:[4,9,31,44]
    },
    programme:{
      frame:{id:'programme-frame',x:5920,y:180,w:2220,h:3940,title:'AI IN TRAVEL SUMMIT',meta:'3 DAYS · SINGAPORE'},
      days:[
        {id:'day-01',label:'DAY 01',detail:'opening · keynote · panel',x:6100,y:470,w:1880,h:990, commitments:[
          {id:'d1-open',name:'OPENING',time:'09:00',x:6410,y:810,tone:'green'},
          {id:'d1-keynote',name:'KEYNOTE',time:'11:00',x:6890,y:650,tone:'green'},
          {id:'d1-panel',name:'PANEL',time:'14:00',x:7330,y:825,tone:'brass'},
          {id:'d1-network',name:'NETWORK',time:'18:00',x:6900,y:1090,tone:'green'}
        ]},
        {id:'day-02',label:'DAY 02',detail:'workshop · meetings · dinner',x:6100,y:1655,w:1880,h:990, commitments:[
          {id:'d2-workshop',name:'WORKSHOP',time:'09:30',x:6400,y:1990,tone:'green'},
          {id:'d2-panel',name:'PANEL',time:'12:30',x:6885,y:1835,tone:'green'},
          {id:'d2-meeting',name:'MEETING',time:'15:00',x:7330,y:2005,tone:'grey'},
          {id:'d2-dinner',name:'DINNER',time:'19:00',x:6900,y:2260,tone:'green'}
        ]},
        {id:'day-03',label:'DAY 03',detail:'plenary · roundtable · close',x:6100,y:2840,w:1880,h:990, commitments:[
          {id:'d3-plenary',name:'PLENARY',time:'09:00',x:6400,y:3175,tone:'green'},
          {id:'d3-round',name:'ROUND',time:'11:30',x:6885,y:3018,tone:'green'},
          {id:'d3-close',name:'CLOSE',time:'16:00',x:7330,y:3185,tone:'green'},
          {id:'d3-depart',name:'DEPART',time:'18:30',x:6900,y:3445,tone:'brass'}
        ]}
      ],
      programmeEdges:[
        ['d1-open','d1-keynote','green'],['d1-keynote','d1-panel','green'],['d1-panel','d1-network','brass'],
        ['d2-workshop','d2-panel','green'],['d2-panel','d2-meeting','grey'],['d2-meeting','d2-dinner','grey'],
        ['d3-plenary','d3-round','green'],['d3-round','d3-close','green'],['d3-close','d3-depart','brass']
      ],
      travellerConnections:[
        [4,'d1-open','green'],[9,'d1-keynote','brass'],[12,'d1-panel','red'],[18,'d1-network','green'],
        [23,'d2-workshop','brass'],[31,'d2-panel','red'],[37,'d2-meeting','green'],[44,'d2-dinner','green'],
        [52,'d3-plenary','brass'],[59,'d3-round','green'],[65,'d3-close','brass'],[70,'d3-depart','green'],
        [6,'d1-keynote','green'],[28,'d2-panel','green'],[46,'d3-round','green'],[58,'d2-dinner','green']
      ]
    },
    anchorConnection:{travellerId:17,from:{x:2210,y:886},target:'d1-keynote',tone:'red'},
    heroes:[
      {id:'hero-17',travellerId:17,label:'T17',x:4020,y:600,target:'d1-keynote',tone:'red', stages:[
        {icon:'✈',kicker:'Flight',value:'Inbound 09:35',meta:'VERIFIED',tone:'green'},
        {icon:'↳',kicker:'Transfer',value:'Airport → Hotel',meta:'12 MIN BUFFER',tone:'brass'},
        {icon:'⌂',kicker:'Hotel',value:'Room held',meta:'LATE ARRIVAL',tone:'brass'},
        {icon:'↳',kicker:'Transfer',value:'Hotel → Venue',meta:'TIGHT',tone:'brass'},
        {icon:'✦',kicker:'Commitment',value:'Keynote 11:00',meta:'NOT VIABLE',tone:'red'}
      ]},
      {id:'hero-31',travellerId:31,label:'T31',x:4020,y:1785,target:'d2-panel',tone:'green', stages:[
        {icon:'✈',kicker:'Flight',value:'Inbound 07:10',meta:'CONFIRMED',tone:'green'},
        {icon:'↳',kicker:'Transfer',value:'Airport → Hotel',meta:'65 MIN BUFFER',tone:'green'},
        {icon:'⌂',kicker:'Hotel',value:'Check-in 09:00',meta:'CONFIRMED',tone:'green'},
        {icon:'↳',kicker:'Transfer',value:'Hotel → Venue',meta:'BOOKED',tone:'green'},
        {icon:'✦',kicker:'Commitment',value:'Panel 12:30',meta:'HEALTHY',tone:'green'}
      ]},
      {id:'hero-65',travellerId:65,label:'T65',x:4020,y:2970,target:'d3-close',tone:'brass', stages:[
        {icon:'✈',kicker:'Flight',value:'Inbound 08:20',meta:'CONFIRMED',tone:'green'},
        {icon:'↳',kicker:'Transfer',value:'Airport → Hotel',meta:'BOOKED',tone:'green'},
        {icon:'⌂',kicker:'Hotel',value:'Room held',meta:'CONFIRMED',tone:'green'},
        {icon:'↳',kicker:'Transfer',value:'Hotel → Venue',meta:'WATCH',tone:'brass'},
        {icon:'✦',kicker:'Commitment',value:'Closing 16:00',meta:'AT RISK',tone:'brass'}
      ]}
    ],
    constraints:[
      {id:'c-arrival',hero:'hero-31',x:4080,y:2020,label:'Arrival deadline',value:'Venue by 11:30',tone:'green',stageIndex:4},
      {id:'c-entry',hero:'hero-31',x:4430,y:2020,label:'Entry requirement',value:'Verified',tone:'green',stageIndex:0},
      {id:'c-pref',hero:'hero-31',x:4780,y:2020,label:'Preference',value:'Direct if possible',tone:'green',stageIndex:0},
      {id:'c-policy',hero:'hero-31',x:5130,y:2020,label:'Policy / cost',value:'≤ US$250 delta',tone:'green',stageIndex:0}
    ],
    finalState:{
      version:'seq06-baseline-v1',
      description:'Connected programme baseline before Seq07 blast-radius mutation',
      boundary:{x:120,y:90,w:8060,h:4100,title:'NORTHSTAR',subtitle:'LIVE DEPENDENCY GRAPH',meta:['72 TRAVELLERS','12 COMMITMENTS','3 DAYS']}
    }
  });
})();
