'use client'

import { useId } from 'react'
import type { KBotActivityMode, KBotState } from './KBotAvatar'
export function KBotDrawing({ state, faceOnly = false, activity = 'idle' }: { state: KBotState; faceOnly?: boolean; activity?: KBotActivityMode }) {
 const id=useId().replace(/:/g,'');
 const signal=state==='waiting'?'#e0b564':state==='error'?'#d9927e':'#a3ecc3';
 return <svg aria-hidden="true" viewBox={faceOnly?'4 3 56 41':'0 0 64 80'} width={faceOnly?48:64} height={faceOnly?40:80} className="kbot-drawing h-full w-full overflow-visible" focusable="false" data-state={state}>
  <defs><linearGradient id={id+'shell'} x1="0" y1="0" x2="0.8" y2="1"><stop stopColor="#f2f7ef"/><stop offset="1" stopColor="#b5cfc0"/></linearGradient><linearGradient id={id+'visor'} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#204d3e"/><stop offset="1" stopColor="#0e2922"/></linearGradient></defs>
  {!faceOnly&&<>
   <ellipse cx="32" cy="77" rx="17" ry="2" fill="#224736" opacity=".1"/>
   <rect x="25" y="38" width="14" height="10" rx="4" fill="#335d49"/>
   <g className="kbot-character-body">
    <rect x="10" y="48" width="7" height="16" rx="3.5" fill="#86ad96"/>
    <rect x="47" y="48" width="7" height="16" rx="3.5" fill="#648d77"/>
    <rect x="16" y="44" width="32" height="26" rx="10" fill={'url(#'+id+'shell)'} stroke="#547d66" strokeWidth="1.3"/>
    <path d="M24 47h16" stroke="#fffdf5" strokeOpacity=".8" strokeWidth="1.5" strokeLinecap="round"/>
    <rect x="23" y="51" width="18" height="13" rx="4" fill="#214f3a"/>
    <path d="M28 54v7m1-3 5-4m-5 4 5 3" fill="none" stroke="#d4efce" strokeWidth="2" strokeLinecap="square"/>
    <circle className="kbot-core-light" cx="39" cy="67" r="1" fill={signal}/>
    <path d="M21 69v3h8v-3M35 69v3h8v-3" fill="#365e49"/>
   </g>
  </>}
  <g className="kbot-character-head-motion" data-kbot-face="true">
   <path className="kbot-character-antenna" d="M32 6v5" stroke="#668c77" strokeWidth="2"/>
   <circle cx="32" cy="5" r="2.5" fill={signal} stroke="#547d66" strokeWidth="1"/>
   <rect x="5" y="22" width="6" height="12" rx="3" fill="#87ad95"/>
   <rect x="53" y="22" width="6" height="12" rx="3" fill="#628b75"/>
   <rect x="9" y="10" width="46" height="33" rx="12" fill={'url(#'+id+'shell)'} stroke="#547d66" strokeWidth="1.3"/>
   <path d="M20 13h23" stroke="#fffdf5" strokeWidth="1.5" strokeLinecap="round"/>
   <rect x="14" y="16" width="36" height="23" rx="8" fill={'url(#'+id+'visor)'} stroke="#254e3e"/>
   <path d="M20 18h22" stroke="#497460" strokeOpacity=".7" strokeWidth="1" strokeLinecap="round"/>
   <g className="kbot-character-eyes">
   <g className="kbot-eye-pupils">
   {state==='success'?<g fill="none" stroke={signal} strokeWidth="2.5" strokeLinecap="round"><path d="M21 27q3-5 6 0M37 27q3-5 6 0"/><path d="M28 32q4 4 8 0" strokeWidth="1.5"/></g>:<>
    <g fill={signal}><rect x="21" y={state==='working'?24:22} width="6" height={state==='working'?5:8} rx="2.5"/><rect x="37" y={state==='working'?24:22} width="6" height={state==='working'?5:8} rx="2.5"/></g>
    {state==='error'?<path d="M29 34q3-3 6 0" fill="none" stroke={signal} strokeWidth="1.5" strokeLinecap="round"/>:state==='waiting'?<circle cx="32" cy="33" r="1.8" fill={signal}/>:<path d="M29 33h6" stroke={signal} strokeWidth="1.5" strokeLinecap="round"/>}
   </>}
   </g>
   </g>
  </g>
 {!faceOnly && ['illustration','application','combined'].includes(activity) && <g data-kbot-paper="true" className="kbot-character-paper">
   <path d="M48 52h9l5 5v17H48z" fill="#eff5e9" stroke="#668d77" strokeWidth="1.2" strokeLinejoin="round"/>
   <path d="M57 52v5h5M51 61h7M51 65h7M51 69h4" fill="none" stroke="#668d77" strokeWidth="1.1" strokeLinecap="round"/>
  </g>}
 </svg>
}
