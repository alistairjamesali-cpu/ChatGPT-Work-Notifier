(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.CWNStateEngine=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const TIMEOUT_PATTERNS=[
    /message delivery timed out\. please try again\.?/i,
    /something went wrong while generating the response/i,
    /network error/i,
    /connection (?:was )?(?:lost|interrupted)/i,
    /failed to get response/i
  ];
  const INCOMPLETE_PATTERNS=[
    /\b(?:this|the) (?:task|work|job|implementation|repair|upgrade|build|audit|request) (?:is|remains) incomplete\b/i,
    /\bnot\s+100\s*%\s*(?:complete|completed|done)\b/i,
    /\b(?:this|the) (?:task|work|job|implementation|repair|upgrade|build|audit|request) (?:is )?not\s+(?:fully\s+)?(?:complete|completed|finished|done|ready)\b/i,
    /\bdo not (?:treat|mark|call|consider).{0,80}\b(?:complete|completed|finished|done)\b/i,
    /\bcannot (?:yet )?(?:be )?(?:treated|called|considered|regarded).{0,80}\b(?:complete|completed|finished|done)\b/i,
    /\bcompletion (?:is|remains) (?:unverified|uncertain|pending|incomplete)\b/i,
    /\b(?:my|our|the) remaining (?:work|steps?|tasks?|phase|phases|items?)\b/i,
    /\b(?:this|the) (?:task|work|job|implementation|repair|upgrade|build|audit|request) (?:is )?not yet (?:finali[sz]ed|complete|completed|finished|packaged|ready)\b/i,
    /\b(?:i|we) still (?:need|needs|needed|have|must|need to|have to)\b/i,
    /\bnext (?:i|we) (?:will|need to|must|have to)\b/i,
    /\bfinal packaging phase\b/i,
    /\bresume (?:needed|required|to continue|the (?:work|task|job)|this (?:work|task|job)|from (?:here|this point)|with (?:the|this) (?:work|task|job))\b/i,
    /\b(?:please|type|enter|send|click)\s+[‘'"]?resume[’'"]?\b/i,
    /\bcontinue(?:d|ing)? (?:the|with|from) (?:work|task|job|audit|repair|upgrade|build|implementation)\b/i
  ];
  const SAFE_COMPLETE_PATTERNS=[
    /\b100\s*%\s*(?:complete|completed|done)\b/i,
    /\btask (?:is )?(?:fully )?complete\b/i,
    /\bwork (?:is )?(?:fully )?complete\b/i,
    /\bfinal (?:zip|package|artifact|file) (?:is )?(?:ready|complete|completed)\b/i,
    /\bcompleted successfully\b/i,
    /\bfinished successfully\b/i,
    /\ball requested work (?:is )?(?:complete|completed|finished)\b/i
  ];

  function clamp(n,min,max){return Math.min(max,Math.max(min,n));}
  function anyMatch(text,patterns){const s=String(text||'');return patterns.some(re=>{re.lastIndex=0;return re.test(s);});}
  function finitePercent(value){if(value==null||value==='')return null;const n=Number(value);return Number.isFinite(n)?clamp(n,0,100):null;}

  function parseProgressPercent(text){
    const s=String(text||'');
    // Only task-progress-shaped markers are authoritative. Bare percentages are deliberately ignored
    // so metrics such as coverage, pass rate, confidence, battery, accuracy, or file counts cannot
    // manufacture a PAUSED/COMPLETE state.
    const patterns=[
      /\b(\d{1,3})\s*%\s*(?:complete|completed|done)\b/ig,
      /\b(?:completion|progress)\s*[:\-–—]?\s*(\d{1,3})\s*%/ig,
      /(?:^|\n)\s*(\d{1,3})\s*%\s*(?:[\-–—]|$)/ig
    ];
    const matches=[];
    for(const re of patterns){
      re.lastIndex=0; let m;
      while((m=re.exec(s))!==null){
        const n=Number(m[1]);
        if(Number.isFinite(n)&&n>=0&&n<=100)matches.push({index:m.index,value:clamp(n,0,100)});
        if(m.index===re.lastIndex)re.lastIndex++;
      }
    }
    if(!matches.length)return null;
    matches.sort((a,b)=>a.index-b.index);
    return matches[matches.length-1].value;
  }

  function parseWorkedSeconds(text){
    const s=String(text||'');
    const re=/\bWorked for\s+(?:(\d+)h\s*)?(?:(\d+)m\s*)?(?:(\d+)s)?\b/ig;
    let m,best=null;
    while((m=re.exec(s))!==null){
      const seconds=(Number(m[1]||0)*3600)+(Number(m[2]||0)*60)+Number(m[3]||0);
      if(seconds>0)best=seconds;
      if(m.index===re.lastIndex)re.lastIndex++;
    }
    return best;
  }

  function normalize(input){
    const x=input||{};
    const assistantText=String(x.assistantText||'').trim();
    const errorText=String(x.errorText||'').trim();
    const workedText=String(x.workedText||'').trim();
    const currentPercent=x.progressPercent==null?parseProgressPercent(assistantText):finitePercent(x.progressPercent);
    return {
      assistantText,errorText,workedText,
      hasStopButton:!!x.hasStopButton,
      hasContinueButton:!!x.hasContinueButton,
      hasThinkingIndicator:!!x.hasThinkingIndicator,
      hasExtendedThinkingBanner:!!x.hasExtendedThinkingBanner,
      hasActiveToolActivity:!!x.hasActiveToolActivity,
      activeToolText:String(x.activeToolText||'').trim(),
      hasCompletedResponseControls:!!x.hasCompletedResponseControls,
      thinkingStableMs:Number.isFinite(Number(x.thinkingStableMs))?Number(x.thinkingStableMs):0,
      awaitingAssistant:!!x.awaitingAssistant,
      waitingInput:!!x.waitingInput,
      composerEmpty:x.composerEmpty!==false,
      stableMs:Number.isFinite(Number(x.stableMs))?Number(x.stableMs):0,
      progressPercent:currentPercent,
      // Provenance is explicit: inherited/history values may be displayed as context,
      // but can never block a safe completion for the current segment.
      currentSegmentProgress: finitePercent(x.currentSegmentProgress == null ? currentPercent : x.currentSegmentProgress),
      progressIsHistorical: x.progressIsHistorical === true || x.progressSource === 'historical',
      inheritedProgress: finitePercent(x.inheritedProgress == null ? x.priorProgressPercent : x.inheritedProgress),
      priorProgressPercent:finitePercent(x.priorProgressPercent),
      workedSeconds:x.workedSeconds==null?parseWorkedSeconds(workedText):Number(x.workedSeconds),
      messageId:String(x.messageId||''),
      generationObserved:!!x.generationObserved,
      workLike:x.workLike!==false,
      pageVisible:x.pageVisible!==false
    };
  }

  function result(status,label,progress,s,safeCompletion,refreshEligible,resumeEligible,manualAction,detail){
    return {status,label,progress,safeCompletion:!!safeCompletion,refreshEligible:!!refreshEligible,resumeEligible:!!resumeEligible,
      manualAction:!!manualAction,detail,messageId:s.messageId,workedSeconds:s.workedSeconds,stableMs:s.stableMs,
      composerEmpty:s.composerEmpty,awaitingAssistant:s.awaitingAssistant,hasThinkingIndicator:s.hasThinkingIndicator,
      hasExtendedThinkingBanner:s.hasExtendedThinkingBanner,hasActiveToolActivity:s.hasActiveToolActivity,activeToolText:s.activeToolText,
      hasCompletedResponseControls:s.hasCompletedResponseControls,
      thinkingStableMs:s.thinkingStableMs,generationObserved:s.generationObserved};
  }

  function classify(input){
    const s=normalize(input);
    const allText=[s.assistantText,s.errorText,s.workedText].filter(Boolean).join(' ');
    const timeout=anyMatch(s.errorText||allText,TIMEOUT_PATTERNS);
    const incomplete=anyMatch(s.assistantText,INCOMPLETE_PATTERNS);
    const safeCompleteText=anyMatch(s.assistantText,SAFE_COMPLETE_PATTERNS);
    const current=s.progressIsHistorical ? null : (s.currentSegmentProgress == null ? s.progressPercent : s.currentSegmentProgress);
    const display=current==null?(s.inheritedProgress == null ? s.priorProgressPercent : s.inheritedProgress):current;
    const stableEnough=s.stableMs>=8000;

    if(timeout)return result('TIMEOUT','Recovering',display,s,false,true,false,false,'Explicit ChatGPT delivery/network timeout. Automatic safe recovery is active.');

    // Platform-level extended-thinking text is positive evidence that the request is still alive.
    // It overrides stale/stuck inference even if ChatGPT changes the Stop-button markup.
    if(s.hasExtendedThinkingBanner){
      const tool=s.hasActiveToolActivity?(s.activeToolText?` Active tool step: ${s.activeToolText}`:' Active tool work is visible.'):'';
      return result('RUNNING','Extended thinking',display,s,false,false,false,false,`ChatGPT reports that its systems are still thinking about this request.${tool}`);
    }

    if(s.hasThinkingIndicator){
      if(s.hasStopButton||s.thinkingStableMs<120000)return result('RUNNING','Thinking',display,s,false,false,false,false,'ChatGPT is actively thinking.');
      return result('STUCK_THINKING','Thinking stuck',display,s,false,false,true,true,'Thinking has remained unchanged for at least two minutes with no Stop control.');
    }

    if(s.awaitingAssistant)return result('RUNNING','Working',display,s,false,false,false,false,'A newer user prompt is waiting for a fresh assistant response.');
    if(s.hasStopButton){
      const tool=s.hasActiveToolActivity?(s.activeToolText?` Active tool step: ${s.activeToolText}`:' Active tool work is visible.'):'';
      return result('RUNNING','Working',display,s,false,false,false,false,`Generation is active.${tool}`);
    }
    if(s.generationObserved&&s.hasContinueButton&&!stableEnough)return result('RUNNING','Settling',display,s,false,false,false,false,'The current run exposed Continue generating; waiting for the control to remain stable.');
    if(s.generationObserved&&s.hasContinueButton)return result('PAUSED','Resume needed',current,s,false,false,true,true,'The observed current run exposed a stable Continue generating control after it stopped.');
    if(s.waitingInput)return result('WAITING_INPUT','Needs input',current,s,false,false,false,true,'The current response is waiting for user input or confirmation.');
    // Text and percentage are meaningful pause evidence only for a run observed by this
    // content-script session. This prevents a finished answer from becoming PAUSED again on
    // the next scan, extension reload, or page restoration. Brief DOM churn must also settle
    // before a partial-progress or incomplete-text pause can pre-fill Resume.
    if(s.generationObserved&&!stableEnough&&((current!=null&&current<100)||incomplete))return result('RUNNING','Settling',display,s,false,false,false,false,'Potential pause evidence is waiting for the response to settle.');
    // Legacy shape retained for auditability: s.generationObserved&&current!=null&&current<100
    if(s.generationObserved&&!s.progressIsHistorical&&current!=null&&current<100)return result('PAUSED','Resume needed',current,s,false,false,true,true,'The observed generation stopped below 100%.');
    if(s.generationObserved&&incomplete)return result('PAUSED','Resume needed',current,s,false,false,true,true,'The observed latest response explicitly says its work remains.');
    if(s.generationObserved&&s.workedSeconds!=null&&s.workedSeconds>=1470&&!safeCompleteText&&current!==100)return result('PAUSED','Resume needed',current,s,false,false,true,true,'Observed long-run stop detected around the 25-minute boundary without completion evidence.');

    // A restored page can contain a genuinely interrupted current turn even though
    // this content-script instance did not witness its initial generation. Explicit
    // sub-100% task progress is strong evidence in that case, but only when the
    // response has no finalized action row. Finished historical answers expose that
    // row and remain display-only, preventing false Resume prompts after reload.
    if(!s.generationObserved&&stableEnough&&current!=null&&current<100&&!s.hasCompletedResponseControls){
      return result('PAUSED','Resume needed',current,s,false,false,true,true,'A stable response stopped below 100% without finalized response controls; Resume may be required.');
    }

    // Never manufacture a fresh completion event from historical DOM that existed before this
    // content script observed the run. Known fault signatures above are still surfaced at startup.
    if(s.generationObserved&&(current===100||safeCompleteText||s.hasCompletedResponseControls)&&stableEnough)return result('COMPLETE','Complete',100,s,true,false,false,false,s.hasCompletedResponseControls?'ChatGPT exposed the finalized response action row after the monitored run ended.':'Strong completion evidence is stable for the run observed by this monitor.');
    // Once an observed assistant response has stopped changing and every explicit active,
    // paused, waiting, timeout, failure, and incomplete signal above is absent, the response
    // is complete. ChatGPT does not promise semantic phrases such as "100% complete", so
    // requiring them turns normal successful responses into manual-verification chores.
    if(s.generationObserved&&s.assistantText&&stableEnough)return result('COMPLETE','Complete',100,s,true,false,false,false,'The monitored response ended normally, remained stable, and has no active, paused, waiting, timeout, failure, or incomplete signal.');
    if(s.generationObserved)return result('RUNNING','Settling',display,s,false,false,false,false,'The monitored response is settling before completion is confirmed.');
    if(!s.generationObserved)return result('IDLE','Idle',display,s,false,false,false,false,'No current monitored run is active. Historical response text is display-only.');
    return result('IDLE','Idle',display,s,false,false,false,false,'No current monitored run is active.');
  }

  return {parseProgressPercent,parseWorkedSeconds,classify,constants:{LONG_RUN_PAUSE_SECONDS:1470,COMPLETE_STABILITY_MS:8000,STUCK_THINKING_MS:120000,EXTENDED_THINKING_IS_RUNNING:true}};
});
