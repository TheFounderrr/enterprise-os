"use client";
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
const colors: Record<string,string> = {ON_TRACK:"#22c784", RISK:"#f5a524", LATE:"#f15f68", DONE:"#317cff"};
import { labels, type Overview } from "./data";
import { Empty } from "./ui";
export function TrendChart({data}:{data:Overview}) { if (!data.counts.planned) return <Empty>За период задач нет</Empty>; return <><div className="chart-key"><span><i/>Выполнено</span><span><i/>Запланировано</span></div>
        <div className="chart"><ResponsiveContainer width="100%" height="100%" minWidth={0}><AreaChart data={data.trend} margin={{left:-23,right:13,top:8,bottom:0}}>
          <defs><linearGradient id="done" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#2378ff" stopOpacity={0.35}/><stop offset="100%" stopColor="#2378ff" stopOpacity={0.02}/></linearGradient></defs>
          <CartesianGrid stroke="var(--line)" vertical={false}/><XAxis dataKey="day" tick={{fill:"var(--muted)",fontSize:12}} axisLine={false} tickLine={false}/><YAxis allowDecimals={false} tick={{fill:"var(--muted)",fontSize:12}} axisLine={false} tickLine={false}/>
          <Tooltip contentStyle={{background:"var(--surface)",border:"1px solid var(--line)",borderRadius:10,color:"var(--text)"}}/>
          <Area isAnimationActive={false} type="monotone" dataKey="planned" name="Запланировано" stroke="#9566f5" fill="transparent" strokeWidth={2}/>
          <Area isAnimationActive={false} type="monotone" dataKey="done" name="Выполнено" stroke="#348bff" fill="url(#done)" strokeWidth={3}/>
        </AreaChart></ResponsiveContainer></div>
      </>; }
export function ProjectStatus({data}:{data:Overview}) { const projectStatus = Object.entries(data.project_status).map(([status,value]) => ({status,value,name:labels[status]})); return projectStatus.length ? <div className="project-status">
        <div className="donut"><ResponsiveContainer width="100%" height="100%" minWidth={0}><PieChart><Pie isAnimationActive={false} data={projectStatus} dataKey="value" innerRadius="71%" outerRadius="96%" startAngle={90} endAngle={-270} stroke="none">{projectStatus.map(s => <Cell key={s.status} fill={colors[s.status]}/>)}</Pie></PieChart></ResponsiveContainer><div><strong>{data.projects.length}</strong><small>Всего</small></div></div>
        <div className="legend">{projectStatus.map(s => <div key={s.status}><i style={{background:colors[s.status]}}/><span>{s.name}</span><b>{s.value}</b></div>)}</div>
      </div> : <Empty>Нет проектов</Empty>; }
