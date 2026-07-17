(function(){
  const page=document.body.dataset.page||'';
  const steps=['basics','paygroup','dates','statutory','population','inputs','review'];
  const policySteps=['identity','work-pattern','pay','sources','jurisdiction','costing','governance'];
  const runTabs=['summary','population','inputs','reconciliation','exceptions','approvals','release','audit'];
  const packageTabs=['overview','components','sources','costing','versions','usage','audit'];
  const policyProfileConfig={
    monthly:{
      name:'Monthly Salaried',
      code:'POL-TT-MONTHLY',
      relationshipOptions:['Employee','Fixed-term employee','Part-time employee','Agency worker'],
      relationship:'Employee',
      groupOptions:['All salaried employees','Head office','Operations','Custom employee group'],
      group:'All salaried employees',
      frequencyOptions:['Monthly','Fortnightly','Weekly'],
      frequency:'Monthly',
      ownerOptions:['Payroll Operations','HR Operations','Payroll Compliance'],
      owner:'Payroll Operations',
      purpose:'Monthly payroll policy for salaried Trinidad and Tobago employees, including recurring earnings, approved adjustments and statutory deductions.'
    },
    offshore:{
      name:'TT Offshore 14/14 Day Rate',
      code:'POL-TT-OFF-1414',
      relationshipOptions:['Employee','Seafarer employee','Agency worker'],
      relationship:'Employee',
      groupOptions:['Offshore platform crew','Marine / vessel crew','Shutdown crew','Standby pool'],
      group:'Offshore platform crew',
      frequencyOptions:['Fortnightly','Monthly','Weekly'],
      frequency:'Fortnightly',
      ownerOptions:['Payroll Operations','Crewing Operations','Payroll Compliance'],
      owner:'Payroll Operations',
      purpose:'Fortnightly payroll policy for Trinidad and Tobago employees assigned to a 14 days on / 14 days off offshore rotation.'
    }
  };

  function shell(){
    const side=document.querySelector('[data-shell-side]');
    const top=document.querySelector('[data-shell-top]');
    const inSetup=page.startsWith('crew-')||page.startsWith('policy-');
    const payrollPage=['command','wizard','run','approval','failed','runs','exceptions','close-run','payslips','payslip-batch','reports','dialogs'].includes(page);
    if(side) side.innerHTML=`
      <div class="brand"><span class="brand-mark">S</span><span>SIOMAC</span></div>
      <a class="nav-item" href="#"><span class="nav-ic">O</span><span>Overview</span></a>
      <div class="nav-label">Finance</div>
      <a class="nav-item" href="#"><span class="nav-ic">A</span><span>Accounts Payable</span></a>
      <a class="nav-item ${payrollPage?'on':''}" href="index.html"><span class="nav-ic">P</span><span>Payroll</span></a>
      ${payrollPage?`<div class="payroll-side-links">
        <a class="nav-item sub ${page==='command'?'on':''}" href="index.html"><span>Command Center</span></a>
        <a class="nav-item sub ${['wizard','run','failed','runs','close-run'].includes(page)?'on':''}" href="runs.html"><span>Payroll Runs</span></a>
        <a class="nav-item sub ${['approval','exceptions'].includes(page)?'on':''}" href="exceptions.html"><span>Approvals &amp; Exceptions</span></a>
        <a class="nav-item sub ${['payslips','payslip-batch'].includes(page)?'on':''}" href="payslips.html"><span>Payslip Batches</span></a>
        <a class="nav-item sub ${page==='reports'?'on':''}" href="reports.html"><span>Reports</span></a>
      </div>`:''}
      <a class="nav-item ${inSetup?'on':''}" href="crew-packages.html"><span class="nav-ic">G</span><span>Payroll Setup</span></a>
      <a class="nav-item" href="#"><span class="nav-ic">S</span><span>Statutory Configuration</span></a>
      <a class="nav-item" href="#"><span class="nav-ic">D</span><span>Bank Disbursements</span></a>
      <a class="nav-item" href="#"><span class="nav-ic">R</span><span>Remittances</span></a>
      <a class="nav-item" href="#"><span class="nav-ic">L</span><span>General Ledger</span></a>
      <div class="nav-label">Administration</div>
      <a class="nav-item" href="#"><span class="nav-ic">H</span><span>Human Resources</span></a>
      <a class="nav-item" href="#"><span class="nav-ic">C</span><span>Access Control</span></a>
      <div class="side-foot">Enterprise payroll design</div>`;
    if(top) top.innerHTML=`
      <div class="top-search">Search &amp; jump to...<kbd>Ctrl K</kbd></div>
      <div class="top-actions"><button class="top-icon" aria-label="Create" type="button">+</button><button class="top-icon" aria-label="Notifications" type="button">!</button><div class="top-user"><span class="av">MJ</span><div><strong>Maya Joseph</strong><small>Payroll Processor</small></div></div></div>`;
  }

  function activate(selector,value,key){
    document.querySelectorAll(selector).forEach(el=>el.classList.toggle('on',el.dataset[key]===value));
  }

  function setPolicySelect(name,options,value){
    const field=document.querySelector(`[data-policy-field="${name}"]`);
    if(!field) return;
    field.replaceChildren(...options.map(option=>new Option(option,option)));
    field.value=value;
  }

  function renderPolicyProfile(requested,persist=true){
    if(page!=='policy-wizard') return;
    const profile=Object.hasOwn(policyProfileConfig,requested)?requested:'monthly';
    const config=policyProfileConfig[profile];
    const profileView=profile==='offshore'?'offshore':'standard';

    document.querySelectorAll('[data-policy-starter]').forEach(input=>{
      input.checked=input.value===profile;
      input.closest('.choice')?.classList.toggle('on',input.checked);
    });

    const name=document.querySelector('[data-policy-field="name"]');
    const code=document.querySelector('[data-policy-field="code"]');
    const purpose=document.querySelector('[data-policy-field="purpose"]');
    if(name) name.value=config.name;
    if(code) code.value=config.code;
    if(purpose) purpose.value=config.purpose;
    setPolicySelect('relationship',config.relationshipOptions,config.relationship);
    setPolicySelect('group',config.groupOptions,config.group);
    setPolicySelect('frequency',config.frequencyOptions,config.frequency);
    setPolicySelect('owner',config.ownerOptions,config.owner);

    const relationshipSummary=document.querySelector('[data-policy-summary="relationship"]');
    const frequencySummary=document.querySelector('[data-policy-summary="frequency"]');
    if(relationshipSummary) relationshipSummary.textContent=config.relationship;
    if(frequencySummary) frequencySummary.textContent=config.frequency;

    document.querySelectorAll('[data-policy-profile-view]').forEach(view=>{
      const active=view.dataset.policyProfileView===profileView;
      view.hidden=!active;
      view.querySelectorAll('input,select,textarea,button').forEach(control=>{control.disabled=!active;});
    });

    if(persist){
      const url=new URL(location.href);
      url.searchParams.set('profile',profile);
      history.replaceState(null,'',url);
    }
    confirmState();
  }

  function centerWizardStep(activeStep){
    const scroller=activeStep?.closest('.wizard-bar');
    if(!activeStep||!scroller) return;
    const left=activeStep.offsetLeft-(scroller.clientWidth-activeStep.offsetWidth)/2;
    scroller.scrollTo({left:Math.max(0,left),behavior:'instant'});
  }

  function wizard(){
    if(page!=='wizard') return;
    const requested=location.hash.slice(1);
    const step=steps.includes(requested)?requested:'basics';
    const index=steps.indexOf(step);
    document.querySelectorAll('[data-step]').forEach(el=>{
      const i=steps.indexOf(el.dataset.step);
      el.classList.toggle('done',i<index);
      el.classList.toggle('active',i===index);
      el.classList.toggle('pend',i>index);
    });
    document.querySelectorAll('[data-connector]').forEach((el,i)=>el.classList.toggle('done',i<index));
    activate('[data-panel]',step,'panel');
    document.querySelectorAll('[data-back]').forEach(el=>{ el.href=index>0?'#'+steps[index-1]:'index.html'; });
    document.querySelectorAll('[data-next]').forEach(el=>{ el.href=index<steps.length-1?'#'+steps[index+1]:'#review'; el.style.display=index===steps.length-1?'none':''; });
    document.querySelectorAll('[data-create]').forEach(el=>{ el.style.display=index===steps.length-1?'':'none'; });
    window.scrollTo({top:0,left:0,behavior:'instant'});
    const activeStep=document.querySelector(`[data-step="${step}"]`);
    requestAnimationFrame(()=>centerWizardStep(activeStep));
  }

  function policyWizard(){
    if(page!=='policy-wizard') return;
    const requested=location.hash.slice(1);
    const step=policySteps.includes(requested)?requested:'identity';
    const index=policySteps.indexOf(step);
    document.querySelectorAll('[data-policy-step]').forEach(el=>{
      const i=policySteps.indexOf(el.dataset.policyStep);
      el.classList.toggle('done',i<index);
      el.classList.toggle('active',i===index);
      el.classList.toggle('pend',i>index);
    });
    document.querySelectorAll('[data-policy-connector]').forEach((el,i)=>el.classList.toggle('done',i<index));
    activate('[data-policy-panel]',step,'policyPanel');
    document.querySelectorAll('[data-policy-back]').forEach(el=>{ el.href=index>0?'#'+policySteps[index-1]:'crew-packages.html'; });
    document.querySelectorAll('[data-policy-next]').forEach(el=>{ el.href=index<policySteps.length-1?'#'+policySteps[index+1]:'#governance'; el.style.display=index===policySteps.length-1?'none':''; });
    document.querySelectorAll('[data-publish]').forEach(el=>{ el.style.display=index===policySteps.length-1?'':'none'; });
    window.scrollTo({top:0,left:0,behavior:'instant'});
    const activeStep=document.querySelector(`[data-policy-step="${step}"]`);
    requestAnimationFrame(()=>centerWizardStep(activeStep));
  }

  function run(){
    if(page!=='run') return;
    const requested=location.hash.slice(1);
    const tab=runTabs.includes(requested)?requested:'summary';
    activate('[data-run-tab]',tab,'runTab');
    activate('[data-run-panel]',tab,'runPanel');
  }

  function packageDetail(){
    if(page!=='crew-package') return;
    const requested=location.hash.slice(1);
    const tab=packageTabs.includes(requested)?requested:'overview';
    activate('[data-package-tab]',tab,'packageTab');
    activate('[data-package-panel]',tab,'packagePanel');
  }

  function commandCenter(){
    if(page!=='command') return;
    const filters=[...document.querySelectorAll('[data-run-filter]')];
    const rows=[...document.querySelectorAll('[data-run-state]')];
    const search=document.querySelector('[data-run-search]');
    const emptyRow=document.querySelector('[data-run-empty]');
    let activeFilter='active';

    function applyRunRows(){
      const query=search?.value.trim().toLowerCase()||'';
      let visibleCount=0;
      rows.forEach(row=>{
        const state=row.dataset.runState;
        const matchesFilter=activeFilter==='active'?state!=='completed':state===activeFilter;
        const matchesSearch=!query||(row.textContent||'').toLowerCase().includes(query);
        row.hidden=!(matchesFilter&&matchesSearch);
        if(!row.hidden) visibleCount+=1;
      });
      if(emptyRow) emptyRow.hidden=visibleCount!==0;
    }

    function applyRunFilter(filter){
      activeFilter=filter;
      filters.forEach(button=>{
        const selected=button.dataset.runFilter===filter;
        button.classList.toggle('on',selected);
        button.setAttribute('aria-selected',String(selected));
      });
      applyRunRows();
    }

    filters.forEach(button=>button.addEventListener('click',()=>applyRunFilter(button.dataset.runFilter||'active')));
    search?.addEventListener('input',applyRunRows);
    applyRunRows();

    const refresh=document.querySelector('[data-command-refresh]');
    refresh?.addEventListener('click',()=>{
      const original=refresh.innerHTML;
      refresh.disabled=true;
      refresh.setAttribute('aria-busy','true');
      refresh.setAttribute('aria-label','Refreshing payroll data');
      refresh.innerHTML='<i class="fa-solid fa-rotate fa-spin"></i>';
      window.setTimeout(()=>{
        refresh.innerHTML='<i class="fa-solid fa-check"></i>';
        refresh.setAttribute('aria-label','Payroll data updated');
        refresh.removeAttribute('aria-busy');
        window.setTimeout(()=>{
          refresh.disabled=false;
          refresh.innerHTML=original;
          refresh.setAttribute('aria-label','Refresh payroll data');
        },900);
      },500);
    });

    applyRunFilter('active');
  }

  function releaseReadinessChart(){
    if(page!=='command') return;
    const canvas=document.querySelector('[data-readiness-chart]');
    if(!canvas) return;
    const ChartCtor=window.Chart;
    if(!ChartCtor) throw new Error('Chart.js is required for the release readiness chart.');
    const reduceMotion=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    canvas.dataset.chartRenderer='chartjs';
    canvas.dataset.chartAnimated='false';
    new ChartCtor(canvas.getContext('2d'),{
      type:'doughnut',
      data:{datasets:[{data:[2,2],backgroundColor:['#f2bd4b','rgba(255,255,255,.18)'],borderWidth:0,hoverOffset:0}]},
      options:{
        responsive:false,
        maintainAspectRatio:false,
        cutout:'76%',
        rotation:-90,
        circumference:360,
        events:[],
        animation:{duration:reduceMotion?0:950,easing:'easeOutQuart',animateRotate:true,animateScale:false,onComplete:()=>{canvas.dataset.chartAnimated='true';}},
        plugins:{legend:{display:false},tooltip:{enabled:false}}
      }
    });
  }

  function confirmState(){
    const create=document.querySelector('[data-create]');
    const runChecks=[...document.querySelectorAll('[data-confirm]')];
    if(create&&runChecks.length) create.disabled=!runChecks.every(c=>c.checked);
    const publish=document.querySelector('[data-publish]');
    const policyChecks=[...document.querySelectorAll('[data-policy-confirm]')].filter(check=>!check.disabled);
    if(publish&&policyChecks.length) publish.disabled=!policyChecks.every(c=>c.checked);
  }

  document.addEventListener('click',e=>{
    const step=e.target.closest('[data-step]');
    if(step){location.hash=step.dataset.step;}
    const policyStep=e.target.closest('[data-policy-step]');
    if(policyStep){location.hash=policyStep.dataset.policyStep;}
    const create=e.target.closest('[data-create]');
    if(create&&!create.disabled&&!create.dataset.dialog){location.href='run.html#summary';}
    const publish=e.target.closest('[data-publish]');
    if(publish&&!publish.disabled){location.href='crew-package.html#overview';}
  });
  document.addEventListener('change',e=>{
    if(e.target.matches('[data-confirm],[data-policy-confirm]')) confirmState();
    if(e.target.matches('[data-policy-starter]')) renderPolicyProfile(e.target.value);
    if(e.target.matches('.choice input[type="radio"]')){
      e.target.closest('.choice-grid')?.querySelectorAll('.choice').forEach(el=>el.classList.toggle('on',el.contains(e.target)));
    }
  });
  window.addEventListener('hashchange',()=>{wizard();policyWizard();run();packageDetail();});
  shell();
  renderPolicyProfile(new URLSearchParams(location.search).get('profile')||'monthly',false);
  wizard();policyWizard();run();packageDetail();commandCenter();releaseReadinessChart();confirmState();
})();
