(function(){
  const dialogs={
    'create-run':{tone:'warning',icon:'fa-file-circle-plus',title:'Create Payroll Run',description:'Commit the reviewed draft and resolved preflight evidence as a new payroll run.',evidence:[['Pay Group','Monthly Salaried'],['Employees','302'],['Pay Date','31 Jul 2026']],notice:'The run is created once with its statutory and pay-policy snapshots. A duplicate business key is refused.',check:'I Confirm The Run Calendar, Population, Inputs, And Resolved Versions',confirm:'Create Draft Run'},
    'save-draft':{icon:'fa-floppy-disk',title:'Save Payroll Draft',description:'Persist this draft and its completed preflight evidence.',evidence:[['Draft','July Monthly'],['Version','7'],['Completed','3 of 5 steps']],notice:'The server draft remains resumable by the assigned payroll owner.',confirm:'Save Draft'},
    'abandon-draft':{tone:'danger',icon:'fa-trash-can',title:'Abandon Payroll Draft',description:'Permanently close this unsubmitted draft.',evidence:[['Draft','PAY-DRAFT-019'],['Owner','Maya Joseph'],['Last Saved','11:42 AST']],notice:'This action is audited. No payroll run or workflow will be created.',field:{label:'Reason For Abandoning',type:'textarea',required:true,placeholder:'Enter the business reason'},check:'I Confirm This Draft Is No Longer Required',confirm:'Abandon Draft'},
    'lock-inputs':{tone:'warning',icon:'fa-lock',title:'Lock Payroll Inputs',description:'Create an immutable source snapshot for calculation.',evidence:[['Employees','302'],['Source Records','641'],['Cutoff','29 Jul, 17:00']],notice:'Late source changes will not enter this run unless it is reopened and a new snapshot is created.',check:'I Confirm All Approved Inputs Through The Cutoff Are Included',confirm:'Lock Inputs'},
    'calculate-run':{icon:'fa-calculator',title:'Calculate Payroll',description:'Start a versioned gross-to-net calculation from the locked snapshot.',evidence:[['Snapshot','v1'],['Employees','302'],['Prior Version','v2']],notice:'The prior valid calculation remains available if this attempt fails.',check:'I Confirm The Input Snapshot And Statutory Version Are Correct',confirm:'Start Calculation'},
    'add-adjustment':{wide:true,icon:'fa-plus-minus',title:'Add Payroll Adjustment',description:'Add one governed earning or deduction to an employee in this run.',evidence:[['Run','PAY-2026-07-M01'],['Employee','Select Below'],['State','Inputs Locked']],field:{label:'Employee',type:'select',options:['Andre Baptiste - EMP-00418','Danielle Moore - EMP-00315','Jason Lewis - EMP-00541']},field2:{label:'Adjustment Type',type:'select',options:['One-Time Earning','One-Time Deduction','Reimbursement','Recovery']},field3:{label:'Amount (TTD)',type:'number',placeholder:'0.00',required:true},field4:{label:'Business Reason',type:'textarea',placeholder:'State the approved reason and evidence reference',required:true},notice:'The adjustment is stored as a separate input, audited, and included only after recalculation.',confirm:'Add Adjustment'},
    'bulk-adjustment':{wide:true,tone:'warning',icon:'fa-users-gear',title:'Apply Bulk Adjustment',description:'Apply the same governed input to selected run participants.',evidence:[['Selected','84 Employees'],['Estimated Impact','TTD 42,000'],['Run State','Inputs Locked']],field:{label:'Adjustment Label',type:'text',placeholder:'Example: Approved Site Allowance',required:true},field2:{label:'Amount Per Employee (TTD)',type:'number',placeholder:'500.00',required:true},field3:{label:'Reason And Evidence',type:'textarea',placeholder:'Enter approval and source references',required:true},notice:'Employees outside this run are skipped. A preview is required before commit.',check:'I Reviewed The Population Preview And Aggregate Impact',confirm:'Apply To 84 Employees'},
    'back-pay':{wide:true,icon:'fa-clock-rotate-left',title:'Add Back-Pay Correction',description:'Calculate a period-correct retroactive earning from released payroll evidence.',evidence:[['Employee','Andre Baptiste'],['From Period','May 2026'],['Current Run','PAY-2026-07-OC02']],field:{label:'Corrected Period Base (TTD)',type:'number',placeholder:'Enter corrected base pay',required:true},field2:{label:'Effective Date',type:'date',required:true},field3:{label:'Correction Reason',type:'textarea',placeholder:'Explain the source correction and approval',required:true},notice:'The preview compares frequency-matched prior runs and prevents duplicate correction intent.',confirm:'Preview Back Pay'},
    'resolve-warning':{tone:'warning',icon:'fa-triangle-exclamation',title:'Resolve Payroll Warning',description:'Record the evidence and decision that clears this warning.',evidence:[['Finding','VAR-2026-0719-05'],['Owner','Maya Joseph'],['Impact','TTD 8,240']],field:{label:'Resolution Note',type:'textarea',placeholder:'Explain the variance and cite the approved source evidence',required:true},notice:'The original warning remains in the audit trail with the resolver, note, and timestamp.',check:'I Reviewed The Supporting Evidence For This Resolution',confirm:'Resolve Warning'},
    'submit-run':{tone:'warning',icon:'fa-paper-plane',title:'Submit Payroll For Approval',description:'Freeze the certified decision package and start maker-checker approval.',evidence:[['Controls','9 of 9 Passed'],['Net Payroll','TTD 7,814,920'],['Approver','Asha Samaroo']],notice:'After submission, payroll inputs and calculation evidence are read-only until returned.',check:'I Certify The Population, Inputs, Variances, And Control Totals',confirm:'Submit For Approval'},
    'approve-run':{icon:'fa-user-check',title:'Approve Payroll',description:'Record an independent approval against the certified calculation.',evidence:[['Run','PAY-2026-07-W04'],['Net Payroll','TTD 1,161,840'],['Calculation','Version 2']],field:{label:'Approval Comment',type:'textarea',placeholder:'Optional decision note'},notice:'Your identity differs from the preparer. This decision advances the run once.',check:'I Reviewed The Certified Evidence And Control Totals',confirm:'Approve Payroll'},
    'return-run':{tone:'warning',icon:'fa-rotate-left',title:'Return Payroll For Correction',description:'Return the run to its processor with specific required actions.',evidence:[['Run','PAY-2026-07-W04'],['Processor','Maya Joseph'],['Decision Due','29 Jul, 12:00']],field:{label:'Correction Reason',type:'textarea',placeholder:'Describe the issue and the evidence that must be corrected',required:true},notice:'The current approval task closes and the run becomes revisable.',confirm:'Return To Processor'},
    'reject-run':{tone:'danger',icon:'fa-ban',title:'Reject Payroll',description:'End this approval attempt and prevent release.',evidence:[['Run','PAY-2026-07-W04'],['Net Payroll','TTD 1,161,840'],['Approver','Asha Samaroo']],field:{label:'Rejection Reason',type:'textarea',placeholder:'Enter a complete, auditable reason',required:true},notice:'A rejected run requires a new corrected submission before it can proceed.',check:'I Understand This Ends The Current Approval Attempt',confirm:'Reject Payroll'},
    'reopen-run':{tone:'danger',icon:'fa-lock-open',title:'Reopen Locked Payroll',description:'Reverse close effects and create a controlled correction path.',evidence:[['Run','PAY-2026-07-M01'],['Locked','30 Jul, 16:18'],['Downstream','GL Not Posted']],field:{label:'Reopen Reason',type:'textarea',placeholder:'State the defect and correction required',required:true},notice:'Loan ledger effects are reversed. Existing evidence remains immutable. Exported runs cannot be reopened.',check:'I Confirm No Irreversible Downstream Release Has Occurred',confirm:'Reopen Payroll'},
    'lock-run':{tone:'warning',icon:'fa-lock',title:'Close And Lock Payroll',description:'Commit the approved payroll as the only source for downstream outputs.',evidence:[['Run','PAY-2026-07-M01'],['Approved Version','v3'],['Net Payroll','TTD 7,814,920']],notice:'Locking freezes employee lines, control totals, approval evidence, and the policy/statutory snapshots.',check:'I Confirm Approval, Funding, Reconciliation, And Output Preconditions Are Complete',confirm:'Close And Lock Payroll'},
    'generate-payslips':{icon:'fa-file-invoice-dollar',title:'Generate Payslip Records',description:'Create one governed payslip record for each locked run line.',evidence:[['Employees','302'],['Template','SIOMAC Standard v6'],['Run','PAY-2026-07-M01']],notice:'Generation is idempotent. Existing payslip records will be reused.',confirm:'Generate 302 Payslips'},
    'render-payslips':{icon:'fa-file-pdf',title:'Render Payslip PDFs',description:'Create password-protected PDFs using the approved run template.',evidence:[['Queued','302'],['Template','SIOMAC Standard v6'],['Fallback','Built-In Enabled']],notice:'Rendering failures remain retryable per employee and do not erase successful files.',check:'I Confirm The Approved Template And Run Totals',confirm:'Render Payslips'},
    'deliver-payslips':{tone:'warning',icon:'fa-envelope-circle-check',title:'Deliver Employee Payslips',description:'Send rendered payslips through approved employee channels.',evidence:[['Ready','299'],['Held','2'],['Missing Channel','1']],field:{label:'Delivery Mode',type:'select',options:['Employee Portal And Email','Employee Portal Only','Email Only']},notice:'Held or invalid recipients are skipped and remain visible in the delivery register.',check:'I Reviewed The Held And Skipped Recipient List',confirm:'Deliver 299 Payslips'},
    'view-payslip':{wide:true,icon:'fa-file-invoice-dollar',title:'Payslip Evidence',description:'Inspect the protected payroll artifact and its delivery history.',evidence:[['Employee','Andre Baptiste'],['Payslip','PS-2026-07-00418'],['Net Pay','TTD 26,670']],field:{label:'Artifact History',type:'select',options:['Rendered v2 - Current','Rendered v1 - Superseded']},notice:'The PDF opens through a short-lived signed URL. Employee access remains restricted to the employee\'s own payslip.',confirm:'Open Protected PDF'},
    'retry-delivery':{tone:'warning',icon:'fa-paper-plane',title:'Retry Payslip Delivery',description:'Retry one failed delivery without resending successful recipients.',evidence:[['Employee','Marcus George'],['Attempt','2'],['Channel','Email']],field:{label:'Delivery Channel',type:'select',options:['Employee Portal And Email','Employee Portal Only','Email Only']},notice:'The prior attempt and failure reason remain in delivery history.',confirm:'Retry Delivery'},
    'schedule-payslip-delivery':{icon:'fa-calendar-check',title:'Schedule Payslip Delivery',description:'Schedule approved payslip artifacts for controlled employee delivery.',evidence:[['Batch','PSB-2026-07-M01'],['Ready','298'],['Timezone','AST']],field:{label:'Delivery Date',type:'date',required:true},field2:{label:'Delivery Window',type:'select',options:['17:30 AST','18:00 AST','After Payroll Release']},notice:'Only rendered and unheld payslips are delivered. The selected batch and template remain immutable.',check:'I Reviewed The Ready, Held, And Failed Recipient Counts',confirm:'Schedule Delivery'},
    'close-payslip-batch':{tone:'warning',icon:'fa-box-archive',title:'Complete Payslip Batch',description:'Close delivery processing and retain the final batch evidence package.',evidence:[['Generated','302'],['Delivered','298'],['Open Exceptions','4']],field:{label:'Close Note',type:'textarea',placeholder:'Explain the disposition of every open recipient',required:true},notice:'A batch can close with explained holds or failures, but unresolved recipients remain visible in audit and reports.',check:'I Confirm Every Undelivered Recipient Has An Owner And Disposition',confirm:'Complete Batch'},
    'reassign-finding':{icon:'fa-user-pen',title:'Reassign Payroll Finding',description:'Move ownership while retaining the original assignment history.',evidence:[['Finding','VAR-2026-0719-05'],['Current Owner','Maya Joseph'],['Due','Today, 11:30 AST']],field:{label:'New Owner',type:'select',options:['Kevin Singh - Payroll','Keisha Grant - HR','Asha Samaroo - Finance']},field2:{label:'Assignment Note',type:'textarea',placeholder:'Explain why ownership is changing',required:true},notice:'The new owner is notified and the original deadline remains unless separately extended.',confirm:'Reassign Finding'},
    'escalate-finding':{tone:'warning',icon:'fa-arrow-up-right-dots',title:'Escalate Payroll Finding',description:'Escalate a time-sensitive finding to the accountable manager.',evidence:[['Finding','VAR-2026-0719-05'],['Impact','TTD 2,367'],['Pay Date','31 Jul 2026']],field:{label:'Escalation Reason',type:'textarea',placeholder:'State the risk, impact, and required decision',required:true},notice:'Escalation does not resolve the finding or change its evidence requirements.',confirm:'Escalate Finding'},
    'comment-finding':{icon:'fa-comment-dots',title:'Add Finding Comment',description:'Record operational context without changing the finding state.',evidence:[['Finding','VAR-2026-0719-05'],['Owner','Maya Joseph'],['Status','Open']],field:{label:'Comment',type:'textarea',placeholder:'Add an auditable comment',required:true},notice:'Comments are timestamped and retained with the finding activity history.',confirm:'Add Comment'},
    'manage-report-schedule':{icon:'fa-calendar-days',title:'Manage Report Schedule',description:'Update a governed recurring payroll report schedule.',evidence:[['Report','Payroll Register'],['Schedule','After Every Payroll Close'],['Owner','Payroll Operations']],field:{label:'Schedule State',type:'select',options:['Active','Paused']},field2:{label:'Recipient Group',type:'select',options:['Payroll Operations','Finance Managers','Internal Audit']},notice:'Schedule changes apply prospectively and are written to the report audit history.',confirm:'Update Schedule'},
    'save-run-view':{icon:'fa-bookmark',title:'Save Payroll Run View',description:'Save the current run filters for repeat operational use.',evidence:[['Frequency','All Frequencies'],['Run Type','All Run Types'],['Status','Current Selection']],field:{label:'View Name',type:'text',placeholder:'Example: Weekly Runs Needing Action',required:true},field2:{label:'Visibility',type:'select',options:['Only Me','Payroll Operations Team']},notice:'Saved views store filters only. They do not change payroll data or access permissions.',confirm:'Save View'},
    'export-run':{icon:'fa-file-export',title:'Create Payroll Export',description:'Generate a versioned, checksummed payroll artifact.',evidence:[['Run','PAY-2026-07-M01'],['Status','Locked'],['Rows','302']],field:{label:'Export Format',type:'select',options:['CSV Register','XLSX Register','JSON Audit Package']},notice:'Each new export becomes current while prior versions remain in artifact history.',confirm:'Create Export'},
    'post-gl':{tone:'warning',icon:'fa-book',title:'Post Payroll To General Ledger',description:'Post the balanced approved journal and link it to this payroll run.',evidence:[['Debit','TTD 9,675,740'],['Credit','TTD 9,675,740'],['Difference','TTD 0.00']],notice:'A duplicate posting is refused. Reversal requires a separate reasoned command.',check:'I Reviewed The Accounts, Cost Dimensions, And Balanced Control Total',confirm:'Post Journal'},
    'reverse-gl':{tone:'danger',icon:'fa-arrow-rotate-left',title:'Reverse Payroll Journal',description:'Create a mirrored reversing journal and unlink the original posting.',evidence:[['Journal','GL-2026-007184'],['Posted','31 Jul, 16:44'],['Balance','TTD 0.00']],field:{label:'Reversal Reason',type:'textarea',placeholder:'State the correction and accounting evidence',required:true},notice:'The original journal remains immutable. This creates a separate reversing journal.',check:'I Confirm Finance Has Authorized This Reversal',confirm:'Reverse Journal'},
    'release-payroll':{tone:'warning',icon:'fa-certificate',title:'Issue Payroll Release Certificate',description:'Finalize the payroll output manifest and hand off downstream work.',evidence:[['Run','PAY-2026-07-M01'],['Outputs','4 of 4 Ready'],['Checksum','9D2A...76F1']],notice:'Payroll closes here. Bank disbursement, remittance, and statutory filing continue in their own governed modules.',check:'I Confirm The Output Manifest And All Downstream Handoffs',confirm:'Issue Certificate'},
    'retry-calculation':{tone:'warning',icon:'fa-rotate',title:'Retry Payroll Calculation',description:'Create a new calculation attempt after corrected source evidence passes preflight.',evidence:[['Prior Attempt','2 - Failed'],['New Snapshot','v2'],['Employees','12']],notice:'Failed attempt 2 and snapshot v1 remain immutable audit evidence.',check:'I Confirm The Two Source Defects Are Corrected And Revalidated',confirm:'Start Attempt 3'},
    'schedule-report':{icon:'fa-clock',title:'Schedule Payroll Report',description:'Deliver a governed report on a recurring schedule.',evidence:[['Report','Payroll Register'],['Format','XLSX'],['Timezone','AST']],field:{label:'Schedule',type:'select',options:['After Every Payroll Close','Monthly On The 1st','Quarterly','Custom']},field2:{label:'Recipients',type:'text',placeholder:'Select approved recipient group',required:true},notice:'Scheduled reports use locked or released data only.',confirm:'Create Schedule'},
    'run-report':{icon:'fa-chart-column',title:'Run Payroll Report',description:'Generate a governed report from the selected locked payroll evidence.',evidence:[['Report','Current Selection'],['Scope','July 2026'],['Format','On-Screen Preview']],notice:'Employee-level reports are permission-gated and the generated artifact is recorded in report history.',confirm:'Generate Report'},
    'draft-conflict':{tone:'warning',icon:'fa-code-compare',title:'Payroll Draft Changed',description:'A newer server version exists for this draft.',evidence:[['Your Version','7'],['Server Version','8'],['Changed By','Kevin Singh']],notice:'Your local changes have not been overwritten. Reload the server draft or create a separate draft copy before continuing.',confirm:'Reload Server Draft'},
    'command-pending':{icon:'fa-spinner',title:'Payroll Command In Progress',description:'The same protected command is already being processed.',evidence:[['Command','Close And Lock'],['Requested','16:18:04 AST'],['Reference','CMD-71A9C2']],notice:'Do not submit the command again. This status will refetch when the durable transaction completes.',confirm:'Return To Run'},
    'access-changed':{tone:'danger',icon:'fa-shield-halved',title:'Payroll Access Changed',description:'Your current session no longer has permission for this command.',evidence:[['Required','finance.payroll.lock'],['Current Role','Payroll Processor'],['Run','PAY-2026-07-M01']],notice:'No payroll state was changed. Ask an administrator to review role access if this command is part of your assigned duties.',confirm:'Return To Payroll Runs'}
  };

  const fieldMarkup=(field,index)=>{
    if(!field)return'';
    const id=`prototype-field-${index}`;
    const required=field.required?' required':'';
    if(field.type==='select')return `<div class="form-field"><label for="${id}">${field.label}</label><select id="${id}"${required}>${field.options.map(x=>`<option>${x}</option>`).join('')}</select></div>`;
    if(field.type==='textarea')return `<div class="form-field full"><label for="${id}">${field.label}</label><textarea id="${id}" placeholder="${field.placeholder||''}"${required}></textarea></div>`;
    return `<div class="form-field"><label for="${id}">${field.label}</label><input id="${id}" type="${field.type||'text'}" placeholder="${field.placeholder||''}"${required}></div>`;
  };

  let dialogReturnFocus=null;

  function closeOverlay(){
    document.querySelector('.prototype-overlay')?.remove();
    document.body.style.overflow='';
    dialogReturnFocus?.focus();
    dialogReturnFocus=null;
  }

  function showToast(title,detail){
    document.querySelector('.prototype-toast')?.remove();
    const toast=document.createElement('div');
    toast.className='prototype-toast';
    toast.setAttribute('role','status');
    toast.innerHTML=`<i class="fa-solid fa-check"></i><div><strong>${title}</strong><small>${detail}</small></div>`;
    document.body.append(toast);
    window.setTimeout(()=>toast.remove(),4200);
  }

  function openDialog(name,trigger){
    const d=dialogs[name];
    if(!d)return;
    closeOverlay();
    dialogReturnFocus=trigger||document.activeElement;
    const overlay=document.createElement('div');
    overlay.className='prototype-overlay';
    const tone=d.tone||'info';
    overlay.innerHTML=`<section class="prototype-dialog${d.wide?' wide':''}" role="dialog" aria-modal="true" aria-labelledby="prototype-dialog-title">
      <header class="dialog-head"><span class="dialog-head-icon ${tone}"><i class="fa-solid ${d.icon}"></i></span><div><h2 id="prototype-dialog-title">${d.title}</h2><p>${d.description}</p></div><button class="dialog-close" type="button" aria-label="Close dialog"><i class="fa-solid fa-xmark"></i></button></header>
      <div class="dialog-body">
        <div class="dialog-notice ${tone}"><i class="fa-solid ${tone==='danger'?'fa-circle-exclamation':tone==='warning'?'fa-triangle-exclamation':'fa-circle-info'}"></i><span>${d.notice}</span></div>
        ${d.evidence?`<div class="dialog-evidence">${d.evidence.map(([k,v])=>`<div><span>${k}</span><strong>${v}</strong></div>`).join('')}</div>`:''}
        ${(d.field||d.field2||d.field3||d.field4)?`<div class="form-row">${fieldMarkup(d.field,1)}${fieldMarkup(d.field2,2)}${fieldMarkup(d.field3,3)}${fieldMarkup(d.field4,4)}</div>`:''}
        ${d.check?`<label class="dialog-check"><input type="checkbox" data-dialog-attest><span>${d.check}</span></label>`:''}
      </div>
      <footer class="dialog-foot"><small>Protected Command · Audit And Event Evidence Required</small><div class="dialog-foot-actions"><button class="btn" type="button" data-dialog-cancel>Cancel</button><button class="btn ${tone==='danger'?'danger':'primary'}" type="button" data-dialog-confirm>${d.confirm}</button></div></footer>
    </section>`;
    document.body.append(overlay);
    document.body.style.overflow='hidden';
    const dialog=overlay.querySelector('.prototype-dialog');
    const confirm=overlay.querySelector('[data-dialog-confirm]');
    const validate=()=>{
      const required=[...overlay.querySelectorAll('[required]')].every(el=>String(el.value||'').trim());
      const attested=!d.check||overlay.querySelector('[data-dialog-attest]')?.checked;
      confirm.disabled=!(required&&attested);
    };
    overlay.querySelectorAll('input,textarea,select').forEach(el=>{el.addEventListener('input',validate);el.addEventListener('change',validate)});
    overlay.querySelector('.dialog-close').addEventListener('click',closeOverlay);
    overlay.querySelector('[data-dialog-cancel]').addEventListener('click',closeOverlay);
    overlay.addEventListener('click',event=>{if(event.target===overlay)closeOverlay()});
    overlay.addEventListener('keydown',event=>{
      if(event.key!=='Tab')return;
      const focusable=[...dialog.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]')];
      const first=focusable[0],last=focusable[focusable.length-1];
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    });
    confirm.addEventListener('click',()=>{
      closeOverlay();
      showToast(`${d.title} Confirmed`,trigger?.dataset.success||'Prototype command completed and audit evidence recorded.');
      if(trigger?.dataset.navigate)window.setTimeout(()=>{location.href=trigger.dataset.navigate},450);
    });
    validate();
    dialog.querySelector('input:not([type=checkbox]),select,textarea,.dialog-close')?.focus();
  }

  function openMenu(trigger){
    document.querySelector('.prototype-popover')?.remove();
    const menuName=trigger.dataset.menu;
    const groups={
      run:`<button data-dialog="add-adjustment"><i class="fa-solid fa-plus-minus"></i>Add Adjustment</button><button data-dialog="back-pay"><i class="fa-solid fa-clock-rotate-left"></i>Add Back Pay</button><button data-dialog="calculate-run"><i class="fa-solid fa-calculator"></i>Recalculate</button><hr><button data-dialog="reopen-run" class="danger"><i class="fa-solid fa-lock-open"></i>Reopen Run</button>`,
      register:`<a href="reports.html"><i class="fa-solid fa-chart-column"></i>Open Reports</a><button data-dialog="export-run"><i class="fa-solid fa-file-export"></i>Export Register</button><a href="dialogs.html"><i class="fa-solid fa-window-restore"></i>View Dialog Library</a>`,
      close:`<button data-dialog="export-run"><i class="fa-solid fa-file-export"></i>Create Export</button><button data-dialog="post-gl"><i class="fa-solid fa-book"></i>Post To GL</button><button data-dialog="reopen-run" class="danger"><i class="fa-solid fa-lock-open"></i>Reopen Run</button>`
    };
    const pop=document.createElement('div');
    pop.className='prototype-popover';
    pop.innerHTML=groups[menuName]||groups.register;
    document.body.append(pop);
    const rect=trigger.getBoundingClientRect();
    pop.style.top=`${Math.min(window.innerHeight-pop.offsetHeight-12,rect.bottom+6)}px`;
    pop.style.left=`${Math.max(12,rect.right-pop.offsetWidth)}px`;
  }

  function registerFilters(){
    document.querySelectorAll('[data-register]').forEach(register=>{
      const tabs=[...register.querySelectorAll('[data-register-filter]')];
      const rows=[...register.querySelectorAll('[data-register-state]')];
      const search=register.querySelector('[data-register-search]');
      const selects=[...register.querySelectorAll('[data-register-select]')];
      const empty=register.querySelector('[data-register-empty]');
      let active=tabs.find(x=>x.classList.contains('on'))?.dataset.registerFilter||'all';
      const apply=()=>{
        const query=(search?.value||'').toLowerCase().trim();
        let count=0;
        rows.forEach(row=>{
          const tabMatch=active==='all'||row.dataset.registerState===active;
          const textMatch=!query||(row.textContent||'').toLowerCase().includes(query);
          const selectMatch=selects.every(select=>select.value==='all'||(row.dataset[select.dataset.registerSelect]||'')===select.value);
          row.hidden=!(tabMatch&&textMatch&&selectMatch);
          if(!row.hidden)count++;
        });
        if(empty)empty.hidden=count!==0;
        register.querySelector('[data-visible-count]')?.replaceChildren(document.createTextNode(String(count)));
      };
      tabs.forEach(tab=>tab.addEventListener('click',()=>{active=tab.dataset.registerFilter;tabs.forEach(x=>x.classList.toggle('on',x===tab));apply()}));
      search?.addEventListener('input',apply);
      selects.forEach(select=>select.addEventListener('change',apply));
      apply();
    });
  }

  function completeExceptionActions(){
    document.querySelectorAll('[data-run-panel="exceptions"] .attention-row').forEach(row=>{
      const button=row.querySelector('button.btn:not([data-dialog])');
      if(!button)return;
      const finding=(row.querySelector('.row-copy strong')?.textContent||'').toLowerCase();
      const href=finding.includes('bank account')?'../bank-disbursements-enterprise/readiness.html':finding.includes('cost-center')?'crew-package.html#costing':finding.includes('embarkation')||finding.includes('asset assignment')?'crew-package.html#sources':'exceptions.html';
      const link=document.createElement('a');
      link.className=button.className;link.href=href;link.textContent=button.textContent||'Open';
      link.setAttribute('aria-label',`${link.textContent.trim()} ${row.querySelector('.row-copy strong')?.textContent||'exception'}`);
      button.replaceWith(link);
    });
  }

  const findingDetails={
    'approval-weekly':{title:'Weekly Field Payroll Approval',ref:'APR-2026-0729-01 · PAY-2026-07-W04',employee:'84 Employees · Weekly Field',employeeSub:'Certified Calculation Version 2',trigger:'Independent Decision Due Today',triggerSub:'Net Payroll TTD 1,161,840',driver:'All Nine Controls Passed',driverSub:'Funding And Payment Readiness Confirmed',evidence:'Certified Decision Package',evidenceSub:'Snapshot, Reconciliation And Variance Evidence',owner:'Asha Samaroo · Finance Manager',ownerSub:'Due Today At 12:00 AST'},
    'approval-offcycle':{title:'Off-Cycle Incentive Approval',ref:'APR-2026-0730-02 · PAY-2026-07-OC03',employee:'43 Employees · Monthly Salaried',employeeSub:'Threshold Approval Required',trigger:'Approval Threshold Exceeded',triggerSub:'Net Payroll TTD 438,560',driver:'Approved Incentive Inputs',driverSub:'43 Source Approvals Attached',evidence:'Threshold Review Package',evidenceSub:'Population, Inputs And Funding Evidence',owner:'Asha Samaroo · Finance Manager',ownerSub:'Due 30 Jul At 14:00 AST'},
    'statutory':{title:'Employee Statutory Profiles Incomplete',ref:'CTRL-2026-0719-02 · PAY-2026-07-M01',employee:'Jason Lewis And Alicia Thomas',employeeSub:'Monthly Salaried',trigger:'Two Payroll Profiles Incomplete',triggerSub:'PAYE Election Or NIS Class Missing',driver:'Employee Master Data',driverSub:'Calculation Cannot Be Certified',evidence:'Verified Profile Update',evidenceSub:'HR Source And Effective Date Required',owner:'HR Payroll Data',ownerSub:'Due Today'},
    'bank-account':{title:'Primary Bank Account Missing',ref:'CTRL-2026-0719-03 · PAY-2026-07-M01',employee:'Marcus George · EMP-00492',employeeSub:'Operations · Monthly Salaried',trigger:'No Effective Payment Account',triggerSub:'Disbursement Handoff Will Hold The Line',driver:'Employee Bank Record',driverSub:'Deposit Authorization Not Recorded',evidence:'Verified Bank Account',evidenceSub:'Masked Account And Authorization Evidence',owner:'Finance Staff',ownerSub:'Due 30 Jul'},
    'cost-centre':{title:'Cost-Centre Mapping Missing',ref:'CTRL-2026-0719-04 · PAY-2026-07-M01',employee:'Operations Acting Allowance',employeeSub:'Component ACT-ALLOW-01',trigger:'No Approved GL Dimension',triggerSub:'Journal Preview Cannot Balance By Cost Centre',driver:'Payroll Component Mapping',driverSub:'Operations Cost Centre Required',evidence:'Approved Mapping',evidenceSub:'Finance Manager Effective-Dated Decision',owner:'Finance Manager',ownerSub:'Due 30 Jul'},
    'variance':{title:'Material Net-Pay Variance',ref:'VAR-2026-0719-05 · PAY-2026-07-M01',employee:'Danielle Moore · EMP-00315',employeeSub:'Human Resources · Monthly Salaried',trigger:'Net Pay Increased 11.2%',triggerSub:'TTD 2,367 Above June Released Payroll',driver:'Acting Allowance',driverSub:'Input ADJ-2026-0198 · Approval Evidence Attached',evidence:'Processor Explanation And Source Approval',evidenceSub:'The Finding Remains Immutable After Resolution',owner:'Maya Joseph · Payroll Processor',ownerSub:'Due Today At 11:30 AST'},
    'funding':{title:'Payroll Funding Shortfall',ref:'FUND-2026-0719-01 · PAY-2026-07-M01',employee:'Monthly Salaried Payroll',employeeSub:'302 Employees · Pay Date 31 Jul',trigger:'Available Funds Below Control Total',triggerSub:'TTD 420,000 Funding Gap',driver:'Settlement Account Balance',driverSub:'Treasury Confirmation Expired',evidence:'Current Funding Confirmation',evidenceSub:'Balance Evidence And Treasury Attestation',owner:'Treasury Operations',ownerSub:'Overdue By 38 Minutes'},
    'resolved-profile':{title:'Employee Profile Warning Resolved',ref:'RES-2026-0718-08 · PAY-2026-07-W04',employee:'Ravi Maharaj · EMP-00411',employeeSub:'Weekly Field',trigger:'NIS Class Was Missing',triggerSub:'Resolved Before Calculation Version 2',driver:'HR Profile Correction',driverSub:'Effective 26 Jul 2026',evidence:'HR Change HR-2026-1841',evidenceSub:'Verified By Keisha Grant',owner:'Kevin Singh · Payroll Processor',ownerSub:'Resolved Today At 09:18 AST'}
  };

  function exceptionQueue(){
    const summary=document.querySelector('[data-finding-summary]');
    const items=[...document.querySelectorAll('[data-finding]')];
    if(!summary||!items.length)return;
    const fields=['title','ref','employee','employeeSub','trigger','triggerSub','driver','driverSub','evidence','evidenceSub','owner','ownerSub'];
    const select=item=>{
      const detail=findingDetails[item.dataset.finding];
      if(!detail)return;
      items.forEach(x=>x.classList.toggle('selected',x===item));
      fields.forEach(field=>{const node=summary.querySelector(`[data-finding-value="${field}"]`);if(node)node.textContent=detail[field]||''});
    };
    items.forEach(item=>{
      item.tabIndex=0;
      item.addEventListener('click',event=>{if(!event.target.closest('a,button'))select(item)});
      item.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();select(item)}});
    });
    select(items.find(x=>x.classList.contains('selected'))||items[0]);
  }

  const reportChartInstances={};
  function renderReportChart(name){
    if(!window.Chart)return;
    const canvas=document.querySelector(`[data-report-chart="${name}"]`);
    if(!canvas||reportChartInstances[name])return;
    const common={responsive:true,maintainAspectRatio:false,animation:{duration:850,easing:'easeOutQuart'},plugins:{legend:{position:'bottom',labels:{usePointStyle:true,boxWidth:8,padding:16,font:{size:11}}},tooltip:{mode:'index',intersect:false}},scales:{x:{grid:{color:'#edf1f6'},ticks:{color:'#64748b',font:{size:10}}},y:{grid:{color:'#edf1f6'},ticks:{color:'#64748b',font:{size:10}}}}};
    const configs={
      cost:{type:'line',data:{labels:['Feb','Mar','Apr','May','Jun','Jul'],datasets:[{label:'Gross Payroll',data:[8.62,8.74,8.81,8.95,9.03,9.24],borderColor:'#2457c5',backgroundColor:'rgba(36,87,197,.10)',tension:.32,fill:true,pointRadius:3},{label:'Net Payroll',data:[7.29,7.36,7.43,7.57,7.68,7.81],borderColor:'#159266',backgroundColor:'transparent',tension:.32,pointRadius:3},{label:'Employer Cost',data:[9.01,9.13,9.20,9.35,9.45,9.68],borderColor:'#7b5ac7',backgroundColor:'transparent',tension:.32,pointRadius:3}]},options:{...common,scales:{...common.scales,y:{...common.scales.y,title:{display:true,text:'TTD Millions',color:'#64748b'}}}}},
      variance:{type:'bar',data:{labels:['Overtime','Acting Allowances','Population','Unpaid Leave','Back Pay'],datasets:[{label:'Impact On Net Payroll (TTD)',data:[84200,51640,37420,-18840,22980],backgroundColor:['#2457c5','#6d4bc3','#159266','#d76a6a','#d89a32'],borderRadius:5}]},options:{...common,indexAxis:'y',plugins:{...common.plugins,legend:{display:false}},scales:{x:{...common.scales.x,title:{display:true,text:'TTD',color:'#64748b'}},y:common.scales.y}}},
      overtime:{type:'bar',data:{labels:['Operations','Field Services','Maintenance','Finance','Human Resources'],datasets:[{label:'Overtime',data:[116400,82400,48600,9200,5100],backgroundColor:'#2457c5',borderRadius:4},{label:'Allowances',data:[68400,51200,37800,14400,18200],backgroundColor:'#7b5ac7',borderRadius:4}]},options:{...common,indexAxis:'y',scales:{x:{...common.scales.x,stacked:true,title:{display:true,text:'TTD',color:'#64748b'}},y:{...common.scales.y,stacked:true}}}}
    };
    if(configs[name]){
      const instance=new Chart(canvas,configs[name]);
      reportChartInstances[name]=instance;
      canvas.dataset.chartReady='true';
      window.requestAnimationFrame(()=>instance.resize());
    }
  }

  function reportTabs(){
    const buttons=[...document.querySelectorAll('[data-report-tab]')];
    if(!buttons.length)return;
    const activate=name=>{
      buttons.forEach(button=>button.classList.toggle('on',button.dataset.reportTab===name));
      document.querySelectorAll('[data-report-panel]').forEach(panel=>panel.classList.toggle('on',panel.dataset.reportPanel===name));
      window.requestAnimationFrame(()=>renderReportChart(name));
    };
    buttons.forEach(button=>button.addEventListener('click',()=>activate(button.dataset.reportTab)));
    activate(buttons[0].dataset.reportTab);
  }

  document.addEventListener('click',event=>{
    const dialogTrigger=event.target.closest('[data-dialog]');
    if(dialogTrigger){event.preventDefault();document.querySelector('.prototype-popover')?.remove();openDialog(dialogTrigger.dataset.dialog,dialogTrigger);return}
    const menuTrigger=event.target.closest('[data-menu]');
    if(menuTrigger){event.preventDefault();openMenu(menuTrigger);return}
    if(!event.target.closest('.prototype-popover'))document.querySelector('.prototype-popover')?.remove();
  });
  document.addEventListener('keydown',event=>{if(event.key==='Escape'){closeOverlay();document.querySelector('.prototype-popover')?.remove()}});

  registerFilters();
  completeExceptionActions();
  exceptionQueue();
  reportTabs();
  window.PayrollPrototype={openDialog,dialogs};
})();
