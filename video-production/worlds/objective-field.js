(()=>{
 const NS=window.NS=window.NS||{};
 const outcomes={4:['green','✓'],9:['brass','▲'],12:['red','✕'],18:['green','✓'],23:['brass','▲'],31:['red','✕'],37:['green','✓'],44:['green','✓'],52:['brass','▲'],59:['green','✓'],65:['brass','▲']};
 const commitments=[
  {id:'d1-opening',day:'DAY 01',name:'OPENING',time:'09:00',x:5750,y:610,tone:'green'},
  {id:'d1-keynote',day:'DAY 01',name:'KEYNOTE',time:'11:00',x:6300,y:470,tone:'green'},
  {id:'d1-panel',day:'DAY 01',name:'PANEL',time:'14:00',x:6840,y:650,tone:'brass'},
  {id:'d1-network',day:'DAY 01',name:'NETWORKING',time:'18:00',x:6350,y:900,tone:'green'},
  {id:'d2-workshop',day:'DAY 02',name:'WORKSHOP',time:'09:30',x:5740,y:1560,tone:'green'},
  {id:'d2-panel',day:'DAY 02',name:'PANEL',time:'13:00',x:6350,y:1430,tone:'green'},
  {id:'d2-meeting',day:'DAY 02',name:'MEETING',time:'15:30',x:6930,y:1605,tone:'grey'},
  {id:'d2-dinner',day:'DAY 02',name:'DINNER',time:'19:00',x:6420,y:1880,tone:'green'},
  {id:'d3-plenary',day:'DAY 03',name:'PLENARY',time:'09:00',x:5740,y:2550,tone:'green'},
  {id:'d3-round',day:'DAY 03',name:'ROUNDTABLE',time:'11:30',x:6320,y:2420,tone:'green'},
  {id:'d3-close',day:'DAY 03',name:'CLOSE',time:'16:00',x:6910,y:2600,tone:'green'}
 ];
 const heroes=[
  {id:'hero-12',travellerId:12,label:'T12',x:4240,y:700,target:'d1-panel',tone:'brass',stages:[
   {id:'flight',icon:'✈',kicker:'Flight',value:'Inbound 10:05',meta:'CHANGED',tone:'brass'},
   {id:'transfer1',icon:'↳',kicker:'Transfer',value:'Airport → Hotel',meta:'WATCH',tone:'brass'},
   {id:'hotel',icon:'⌂',kicker:'Hotel',value:'Room held',meta:'CONFIRMED',tone:'green'},
   {id:'transfer2',icon:'↳',kicker:'Transfer',value:'Hotel → Venue',meta:'BOOKED',tone:'green'},
   {id:'objective',icon:'✦',kicker:'Commitment',value:'Panel 14:00',meta:'AT RISK',tone:'brass'}]},
  {id:'hero-37',travellerId:37,label:'T37',x:4240,y:1450,target:'d2-panel',tone:'green',stages:[
   {id:'flight',icon:'✈',kicker:'Flight',value:'JL711 · 07:10',meta:'CONFIRMED',tone:'green'},
   {id:'transfer1',icon:'↳',kicker:'Transfer',value:'Airport → Hotel',meta:'65 MIN BUFFER',tone:'green'},
   {id:'hotel',icon:'⌂',kicker:'Hotel',value:'Check-in 09:00',meta:'CONFIRMED',tone:'green'},
   {id:'transfer2',icon:'↳',kicker:'Transfer',value:'Hotel → Venue',meta:'BOOKED',tone:'green'},
   {id:'objective',icon:'✦',kicker:'Commitment',value:'Panel 13:00',meta:'HEALTHY',tone:'green'}]},
  {id:'hero-65',travellerId:65,label:'T65',x:4240,y:2550,target:'d3-close',tone:'brass',stages:[
   {id:'flight',icon:'✈',kicker:'Flight',value:'Inbound 08:20',meta:'CONFIRMED',tone:'green'},
   {id:'transfer1',icon:'↳',kicker:'Transfer',value:'Airport → Hotel',meta:'BOOKED',tone:'green'},
   {id:'hotel',icon:'⌂',kicker:'Hotel',value:'Room held',meta:'CONFIRMED',tone:'green'},
   {id:'transfer2',icon:'↳',kicker:'Transfer',value:'Hotel → Venue',meta:'WATCH',tone:'brass'},
   {id:'objective',icon:'✦',kicker:'Commitment',value:'Closing 16:00',meta:'AT RISK',tone:'brass'}]}
 ];
 NS.OBJECTIVE_FIELD=Object.freeze({
  version:'objective-field-v2',world:{width:7800,height:3600},
  cameras:{seq04Final:{x:-12,y:-24,scale:.33},programme:{x:-170,y:30,scale:.275},hero37:{x:-1830,y:-520,scale:.56},affected37:{x:-2010,y:-600,scale:.60},strategy37:{x:-1360,y:-300,scale:.46},integration:{x:-1350,y:-120,scale:.43},authority:{x:-1750,y:-720,scale:.54},finalJourney:{x:-2620,y:-840,scale:.80},wideFinal:{x:-170,y:30,scale:.275}},
  scaleField:{count:72,heroId:17,cols:[640,1500,2360,3220,4080,4940],rowStart:690,rowStep:215,outcomes},
  seq04Carry:{
   supplier:{title:'AIRLINE RETIME',affected:'12 AFFECTED',scope:'ONE CHANGE',representative:[4,9,31,44]},
   hero:{travellerId:17,heading:'TRAVELLER 17 · inbound journey · objective dependency',headingX:920,headingY:748,nodes:[
    {id:'flight',x:920,tone:'green',kicker:'Flight',value:'Inbound 09:35',meta:'REBOOKED · VERIFIED'},
    {id:'transfer',x:1260,tone:'brass',kicker:'Transfer',value:'Airport → Hotel',meta:'12 MIN BUFFER · AT RISK'},
    {id:'hotel',x:1600,tone:'brass',kicker:'Hotel',value:'Room held',meta:'LATE ARRIVAL · NEEDS EYES'},
    {id:'commitment',x:1940,tone:'red',kicker:'✦ Keynote',value:'Main stage 13:00',meta:'ARRIVAL 13:18 · NOT VIABLE',wide:true}
   ],edges:[
    {id:'ft',d:'M1150 886 C1192 886 1218 886 1260 886',tone:'brass'},
    {id:'th',d:'M1490 886 C1532 886 1558 886 1600 886',tone:'brass'},
    {id:'hc',d:'M1830 886 C1872 886 1898 886 1940 886',tone:'red'}
   ]}
  },
  dayLabels:[{id:'day1',label:'DAY 01',x:5650,y:350},{id:'day2',label:'DAY 02',x:5650,y:1300},{id:'day3',label:'DAY 03',x:5650,y:2290}],
  commitments,
  programmeEdges:[['d1-opening','d1-keynote','green'],['d1-keynote','d1-panel','green'],['d1-panel','d1-network','brass'],['d2-workshop','d2-panel','green'],['d2-panel','d2-meeting','grey'],['d2-meeting','d2-dinner','grey'],['d3-plenary','d3-round','green'],['d3-round','d3-close','green']],
  docking:[
   {travellerId:6,target:'d1-opening',tone:'green'},{travellerId:12,target:'d1-panel',tone:'red'},{travellerId:18,target:'d1-keynote',tone:'green'},
   {travellerId:31,target:'d2-workshop',tone:'red'},{travellerId:25,target:'d2-panel',tone:'green'},{travellerId:28,target:'d2-panel',tone:'green'},{travellerId:37,target:'d2-panel',tone:'green'},{travellerId:44,target:'d2-dinner',tone:'green'},
   {travellerId:52,target:'d3-plenary',tone:'brass'},{travellerId:59,target:'d3-round',tone:'green'},{travellerId:65,target:'d3-close',tone:'brass'},{travellerId:70,target:'d3-close',tone:'green'}
  ],
  miniDocking:[
   {travellerId:6,x:5000,y:668,target:'d1-opening',tone:'green'},
   {travellerId:12,x:5000,y:884,target:'d1-panel',tone:'red'},
   {travellerId:31,x:5000,y:1528,target:'d2-workshop',tone:'red'},
   {travellerId:37,x:5000,y:1743,target:'d2-panel',tone:'green'},
   {travellerId:65,x:5000,y:2818,target:'d3-close',tone:'brass'}
  ],
  heroes,
  constraints:[
   {id:'c-arrive',hero:'hero-37',stage:'objective',x:4510,y:1240,label:'ARRIVE BY',value:'12:20',tone:'green'},
   {id:'c-direct',hero:'hero-37',stage:'flight',x:4210,y:1715,label:'PREFERENCE',value:'Direct preferred',tone:'green'},
   {id:'c-entry',hero:'hero-37',stage:'flight',x:4545,y:1715,label:'ENTRY',value:'Verified',tone:'green'},
   {id:'c-policy',hero:'hero-37',stage:'flight',x:4880,y:1715,label:'POLICY',value:'≤ +US$250',tone:'green'}
  ],
  baseline:{version:'seq06-baseline-v2',hero:'hero-37',focusCommitment:'d2-panel'},
  mutation:{
   version:'seq07-impacted-v1',signal:{source:'SUPPLIER CHANGE',text:'JL711 RETIMED · +02:05',tone:'brass'},affectedHero:'hero-37',commitment:'d2-panel',
   stageStates:{flight:'brass',transfer1:'brass',hotel:'green',transfer2:'red',objective:'red'},
   stageMeta:{flight:'RETIMED +02:05',transfer1:'BUFFER COLLAPSED',hotel:'ROOM STILL HELD',transfer2:'NO LONGER WORKS',objective:'NOT VIABLE'},
   commitmentBase:'13:00',commitmentWatch:'13:00 · SPEAKER AT RISK',
   outcomes:{affected:{travellerId:37,tone:'red',glyph:'✕',label:'NOT VIABLE'},watch:{travellerId:25,tone:'brass',glyph:'▲',label:'WATCH'},healthy:{travellerId:43,tone:'green',glyph:'✓',label:'HEALTHY'}}
  },
  inputs:[
   {id:'input-request',source:'TRAVELLER REQUEST',raw:'“I’m presenting at 1pm — can’t miss it.”',x:3300,y:780,tone:'brass',structured:{label:'ARRIVE BY',value:'12:20',target:'objective',x:5000,y:1225}},
   {id:'input-flight',source:'FLIGHT UPDATE',raw:'JL711 retimed +02:05. New arrival 11:55.',x:3300,y:990,tone:'brass',structured:{label:'ARRIVAL',value:'11:55',target:'flight',x:4010,y:1210}},
   {id:'input-hotel',source:'HOTEL UPDATE',raw:'Late-arrival hold remains valid until 14:00.',x:3300,y:1200,structured:{label:'ROOM HOLD',value:'14:00',target:'hotel',x:4680,y:1840}},
   {id:'input-policy',source:'ORGANISATION POLICY',raw:'Travel change allowed up to US$250 delta.',x:3300,y:1410,structured:{label:'POLICY',value:'≤ +US$250',target:'flight',x:4010,y:1840}},
   {id:'input-insurance',source:'INSURANCE',raw:'Missed-connection cover eligible after 90 min.',x:3300,y:1620,structured:{label:'COVER',value:'ELIGIBLE',target:'transfer1',x:4345,y:1840}},
   {id:'input-entry',source:'IMMIGRATION',raw:'Singapore entry requirements verified.',x:3300,y:1830,structured:{label:'ENTRY',value:'VERIFIED',target:'flight',x:4345,y:1210}}
  ],
  strategies:[
   {id:'strategy-flight',name:'TRAVEL CHANGE',x:5380,y:1100,time:'12:42',cost:'+US$168',objective:'MISSED',result:'✕ MISSES PANEL',state:'alert'},
   {id:'strategy-stay',name:'STAY CHANGE',x:5800,y:1350,time:'13:18',cost:'+US$55',objective:'MISSED',result:'✕ CONNECTION STILL IMPOSSIBLE',state:'alert'},
   {id:'strategy-programme',name:'PROGRAMME CHANGE',x:5380,y:1650,time:'12:20',cost:'US$0',objective:'VIABLE',result:'✓ VIABLE · NEEDS AUTHORITY',state:'ok'},
   {id:'strategy-combined',name:'COMBINED RECOVERY',x:5800,y:1900,time:'12:14',cost:'+US$212',objective:'VIABLE',result:'✓ VIABLE · VERIFY FLIGHT',state:'active'}
  ],
  integrations:{qwen:{id:'qwen',kind:'qwen',provider:'ALIBABA CLOUD · QWEN',role:'AI reasoning implementation',sub:'Messy context → structured constraints → recovery strategy reasoning',x:3600,y:430},atlas:{id:'atlas',kind:'atlas',provider:'ATLAS GDS API',role:'Flight search + verify',sub:'Provider availability, fare and rule evidence returned into NORTHSTAR',x:6250,y:1680},evidence:{id:'atlas-evidence',label:'ATLAS / PROVIDER EVIDENCE',route:'HND → SIN',availability:'AVAILABLE',fare:'US$212 DELTA',rule:'CHANGE PERMITTED',time:'ARR 10:58',x:6200,y:1940}},
  recovery:{version:'seq08-strategies-v1',viableStrategyIds:['strategy-programme','strategy-combined'],atlasStrategyId:'strategy-combined'},
  authority:{rule:{x:5520,y:2210,w:1760},auto:{id:'action-auto',strategyId:'strategy-combined',title:'COMBINED RECOVERY',policy:'✓',authority:'✓',execute:'EXECUTE → OBSERVE → STATE UPDATE',x:5640,y:2300},human:{id:'action-human',strategyId:'strategy-programme',title:'PROGRAMME CHANGE',policy:'✓',authority:'✕ OUTSIDE DELEGATION',execute:'STOP · HUMAN DECISION',x:6200,y:2300},decision:{id:'decision',impact:'PANEL MOVE AFFECTS 3 SPEAKERS / 1 ROOM',x:5640,y:2520,options:[{name:'OPTION A · Move panel +30 min',detail:'US$0 · commitment restored · 3 attendee notifications · recommended'},{name:'OPTION B · Keep programme / buy travel recovery',detail:'+US$212 · traveller arrives 12:14 · no programme impact'}]}},
  seq10Handoff:{version:'seq10-human-decision-v1',camera:{x:-5300,y:-2320,scale:1.05},decisionId:'decision'},
  handoffs:{
   seq05To06:{state:'objective-field-v2',camera:'programme'},
   seq06To07:{state:'seq06-baseline-v2',camera:'wideFinal'},
   seq07To08:{state:'seq07-impacted-v1',camera:'affected37'},
   seq08To09:{state:'seq08-strategies-v1',camera:'strategy37'},
   seq09To10:{state:'seq09-verified-v1',camera:'integration',verifiedStrategyId:'strategy-combined'},
   seq10ToUi:{state:'seq10-human-decision-v1',camera:{x:-5300,y:-2320,scale:1.05},decisionId:'decision'}
  },
  finalJourney:{id:'final-journey',label:'TRAVELLER · RESTORED',x:3500,y:1500,stages:[{id:'flight',icon:'✈',kicker:'Flight',value:'Confirmed',meta:'HEALTHY',tone:'green'},{id:'transfer1',icon:'↳',kicker:'Transfer',value:'Airport → Hotel',meta:'HEALTHY',tone:'green'},{id:'hotel',icon:'⌂',kicker:'Hotel',value:'Stay confirmed',meta:'HEALTHY',tone:'green'},{id:'transfer2',icon:'↳',kicker:'Transfer',value:'Hotel → Venue',meta:'HEALTHY',tone:'green'},{id:'objective',icon:'✦',kicker:'Commitment',value:'Objective met',meta:'VIABLE',tone:'green'}]}
 });
})();
