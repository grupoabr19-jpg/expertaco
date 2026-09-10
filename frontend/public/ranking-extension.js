(function(){
  if (!sections.some(item => item.id === 'ranking')) sections.splice(1, 0, { id:'ranking', icon:'R$', label:'Ranking' });
  meta.ranking = ['02','Ranking comercial','Desempenho por tonelagem e percentual da meta, conforme a planilha comercial.'];

  const percentage = item => Number.isFinite(Number(item.attainment)) ? Number(item.attainment) : null;
  const ordered = items => items.filter(item => percentage(item)!==null).sort((a,b)=>(a.position||0)-(b.position||0));
  const identity = (item,kind) => kind==='team'
    ? `<strong>${item.leader||'L&iacute;der a definir'}</strong><small>${item.route||item.name||'Regi&atilde;o a definir'}</small>`
    : `<strong>${item.name||'Vendedor a definir'}</strong><small>${item.route||'Regi&atilde;o a definir'}</small>`;
  const tons = value => value!=null&&Number.isFinite(Number(value)) ? Number(value).toLocaleString('pt-BR')+' Ton.' : '&mdash;';
  const sum = (items,key) => items.reduce((total,item)=>Number.isFinite(Number(item[key]))?total+Number(item[key]):total,0);
  const goalSummary = (data,teams) => {
    if(data.goalSummary)return data.goalSummary;
    const soldTons=sum(teams,'tons'),targetTons=sum(teams,'targetTons');
    return {soldTons,targetTons,attainment:targetTons>0?(soldTons/targetTons)*100:null,challengeTargetTons15:targetTons*1.15,challengeTargetTons30:targetTons*1.3};
  };
  const goalCard = summary => {
    const attainment=Number.isFinite(Number(summary.attainment))?Number(summary.attainment).toFixed(1)+'%':'&mdash;';
    const items=[
      ['Venda total at&eacute; o momento',tons(summary.soldTons),'Realizado acumulado'],
      ['% da meta atingida',attainment,'Progresso geral'],
      ['Meta total',tons(summary.targetTons),'Toneladas'],
      ['Meta desafio +15%',tons(summary.challengeTargetTons15),'Pr&ecirc;mio por atingir a meta desafio'],
      ['Meta desafio +30%',tons(summary.challengeTargetTons30),'Pr&ecirc;mio por atingir a meta desafio 2']
    ];
    return `<div class="goal-summary">${items.map(item=>`<span><small>${item[0]}</small><b>${item[1]}</b><em>${item[2]}</em></span>`).join('')}</div>`;
  };
  const table = (items,kind) => {
    const rows=ordered(items);
    if(!rows.length)return '<div class="ranking-empty">Aguardando dados da planilha de ranking.</div>';
    const label=kind==='team'?'Regi&atilde;o / equipe':'Vendedor / regi&atilde;o';
    return `<div class="ranking-table"><div class="ranking-row ranking-head"><span>Pos.</span><span>${label}</span><span>Realizado</span><span>Meta</span><span>% da meta</span><span>Status (%T)</span></div>${rows.map(x=>`<div class="ranking-row"><b>${x.position}&ordm;</b><span>${identity(x,kind)}</span><span>${tons(x.tons)}</span><span>${tons(x.targetTons)}</span><em>${Number(x.attainment).toFixed(1)}%</em><span>${x.status||'&mdash;'}</span></div>`).join('')}</div>`;
  };
  const populate = data => {
    const teams=data.teams||data.regions||[], sellers=data.sellers||[], management=data.management||{};
    for(let index=cards.length-1;index>=0;index--) if(cards[index].section==='ranking') cards.splice(index,1);
    cards.push(
      {id:'ranking-leadership',section:'ranking',audience:'todos',title:'Lideran&ccedil;a comercial',tags:['gest&atilde;o'],html:`<div class="leadership"><span><small>Dire&ccedil;&atilde;o geral</small><b>${management.generalManager||'&mdash;'}</b></span><span><small>Gerente de vendas</small><b>${management.salesManager||'&mdash;'}</b></span><span><small>Supervisor de vendas</small><b>${management.salesSupervisor||'&mdash;'}</b></span></div>`},
      {id:'ranking-goals',section:'ranking',audience:'todos',title:'Dados da meta',tags:['meta'],html:goalCard(goalSummary(data,teams))},
      {id:'ranking-teams',section:'ranking',audience:'todos',title:'Ranking por regi&atilde;o / equipe',tags:['ranking'],html:table(teams,'team')},
      {id:'ranking-sellers',section:'ranking',audience:'todos',title:'Ranking por vendedor',tags:['ranking'],html:table(sellers,'seller')}
    );
    renderNav(); renderContent(); observeSections();
  };
  window.populateRanking=populate;
  window.loadRanking?.();
  setInterval(()=>window.loadRanking?.(),300000);
})();
