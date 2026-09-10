(function(){
  const sectionResources={ranking:'ranking',rotas:'sales_routes',regras:'commercial_content',portfolio:'commercial_content',marketing:'commercial_content',prospeccao:'scripts',followup:'scripts',objecoes:'scripts',fechamento:'scripts',reativacao:'scripts',kommo:'scripts'};
  const topResources={portfolio:'commercial_content',marketing:'commercial_content',prospeccao:'scripts',objecoes:'scripts',reativacao:'scripts',kommo:'scripts',ranking:'ranking'};
  const allowed=(permissions,resource)=>permissions?.[resource]==='view'||permissions?.[resource]==='manage';
  async function applyAccess(){
    let access={permissions:{},isSuperAdmin:false};try{const response=await fetch('/api/access/me',{credentials:'same-origin'});if(response.ok)access=await response.json();}catch{}
    const can=resource=>access.isSuperAdmin||allowed(access.permissions,resource);
    window.portalAccess=access;
    for(let index=sections.length-1;index>=0;index--){const resource=sectionResources[sections[index].id];if(resource&&!can(resource))sections.splice(index,1);}
    document.querySelectorAll('.topnav a').forEach(link=>{const id=(link.getAttribute('href')||'').replace(/^.*[#/]/,'');const resource=topResources[id];if(resource&&!can(resource))link.remove();});
    document.body.classList.toggle('ticker-denied',!can('ranking'));
    if(!can('ranking')){const ticker=document.querySelector('#ticker');if(ticker)ticker.hidden=true;}
    const current=(location.pathname.replace(/^\/+|\/+$/g,'')||location.hash.replace(/^#/,'')||'visao');if(sectionResources[current]&&!sections.some(item=>item.id===current)){history.replaceState({},'',location.pathname.startsWith('/')?'/conta':'#conta');}
    renderNav();renderContent();observeSections();
  }
  applyAccess();
})();