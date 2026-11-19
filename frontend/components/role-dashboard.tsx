"use client";

import Link from "next/link";
import { Activity, Bell, CalendarDays, CheckSquare, ClipboardList, Clock3, FolderKanban, Layers3, Plus, Users, AlertTriangle, ChevronRight, BriefcaseBusiness } from "lucide-react";
import type { ReactNode } from "react";
import { dateText, labels, type Employee, type Note, type Overview, type RequestRow, type Task, type User } from "./data";
import { Avatar, Badge, Empty, Panel, Stat } from "./ui";
import dynamic from "next/dynamic";
import { ProjectTable } from "./dashboard";

const TrendChart = dynamic(() => import("./workspace-charts").then(module=>module.TrendChart), {
  ssr:false, loading:()=> <div className="chart skeleton" aria-label="Загрузка графика"/>,
});
const ProjectStatus = dynamic(() => import("./workspace-charts").then(module=>module.ProjectStatus), {
  ssr:false, loading:()=> <div className="chart skeleton" aria-label="Загрузка графика"/>,
});

type Props = {
  user: User; data: Overview; requests: RequestRow[]; people: Employee[]; notes: Note[];
  department?: string; departmentId: string; dateStart:string; dateEnd:string; open: (kind: string, row?: RequestRow) => void;
};

function Metric({href,title,value,detail,icon,color}: {href:string;title:string;value:ReactNode;detail?:string;icon:ReactNode;color?:string}) {
  return <Link className="metric-link" href={href} aria-label={[title,value,detail].filter(value=>typeof value==="number" || typeof value==="string").join(" · ")}><Stat {...{title,value,detail,icon,color}}/></Link>;
}

function TaskRows({items}: {items:Task[]}) {
  return items.length ? items.map(t => <div className="work-row" key={t.id}><Link href={"/tasks/" + t.id} className="work-title"><span className="tile"><CheckSquare size={17}/></span><span><b>{t.name}</b><small>{dateText(t.deadline)}</small></span></Link><Badge value={t.priority}/></div>) : <Empty>Нет задач</Empty>;
}

function RequestRows({rows,people}: {rows:RequestRow[];people?:Employee[]}) {
  return rows.length ? rows.map(r => <Link className="list-row" key={r.id} href={"/requests/" + r.id}><span className="tile violet"><ClipboardList/></span><span><b>{people?.find(p=>p.id===r.user_id)?.name || labels[r.kind]}</b><small>{people && labels[r.kind] + " · "}{dateText(r.start)} — {dateText(r.end)}</small></span><Badge value={r.status}/></Link>) : <Empty>Заявлений пока нет</Empty>;
}

function Absences({data,people,generic}: {data:Overview;people:Employee[];generic?:boolean}) {
  const rows = data.absences || [];
  return rows.length ? rows.slice(0,5).map(a => <div className="list-row" key={a.id}><span className="tile violet"><CalendarDays/></span><span><b>{people.find(p=>p.id===a.user_id)?.name || "Сотрудник"}</b><small>{dateText(a.start)} — {dateText(a.end)}</small></span><Badge value={!generic && a.kind === "LEAVE" ? "LEAVE" : "ABSENT"}/></div>) : <Empty>На ближайшие 14 дней отсутствий нет</Empty>;
}

function DepartmentRows({data,completion}: {data:Overview;completion?:boolean}) {
  const rows = data.department_stats || [];
  const total = Math.max(data.counts.employees,1);
  return rows.length ? <div className="department-list">{rows.map(d => {
    const value = completion ? d.planned ? Math.round(d.done / d.planned * 100) : 0 : Math.round(d.people / total * 100);
    return <Link key={d.id} href={"/" + (completion ? "tasks" : "employees") + "?department=" + d.id} className="department-row">
      <div><b>{d.name}</b><small>{completion ? d.done + " из " + d.planned : d.people + " чел."}</small></div>
      <div className="progress"><i style={{width:value+"%"}}/></div>
    </Link>;
  })}</div> : <Empty>Нет данных по отделам</Empty>;
}

const all = (href:string,label:string) => <Link className="text-link" href={href}>{label}</Link>;
const filter = (departmentId:string) => departmentId ? "&department=" + departmentId : "";

function Director({data,departmentId,dateStart,dateEnd,open}:Props) {
  const c=data.counts, suffix = filter(departmentId);
  return <>
    <div className="stats">
      <Metric href={"/employees?scope=all"+suffix} title="Сотрудники" value={c.employees} detail={c.working+" на смене сегодня"} icon={<Users/>}/>
      <Metric href={"/projects?status=active"+suffix} title="Активные проекты" value={c.projects} detail={data.projects.length+" проектов в выборке"} icon={<Layers3/>}/>
      <Metric href={"/tasks?from="+dateStart+"&to="+dateEnd+suffix} title="Выполнение плана" value={c.completion+"%"} detail={c.finished+" из "+c.planned+" задач периода"} color="green" icon={<Activity/>}/>
      <Metric href={"/tasks?due=overdue"+suffix} title="Просроченные задачи" value={c.overdue} detail={c.active+" активных задач"} color="red" icon={<AlertTriangle/>}/>
    </div>
    <div className="work-grid"><Panel title="Динамика выполнения задач"><TrendChart data={data}/></Panel><Panel title="Статусы проектов"><ProjectStatus data={data}/></Panel></div>
    <div className="work-grid"><Panel title="Выполнение по отделам"><DepartmentRows data={data} completion/></Panel><Panel title="Отпуска и отсутствия" action={all("/schedule","График смен")}><div className="staff-overview"><div><strong>{c.leave}</strong><span>В отпуске</span></div><div><strong>{c.absent}</strong><span>Отсутствуют всего</span></div><div><strong>{c.pending}</strong><span>Заявлений в очереди</span></div></div></Panel></div>
    <div className="work-grid"><Panel title="Требуют внимания" action={all("/tasks?due=overdue","Просроченные задачи")}><TaskRows items={data.overdue.slice(0,3)}/></Panel><Panel title="Ближайшие дедлайны" action={all("/tasks?due=upcoming","Все сроки")}><TaskRows items={data.upcoming.slice(0,3)}/></Panel></div>
    <div className="work-grid"><Panel title="Проекты" action={all("/projects","Все проекты")}><ProjectTable projects={data.projects.slice(0,5)}/></Panel><Panel title="Последние события">{data.activity?.length ? data.activity.map(a=><div className="work-row" key={a.id}><span><b>{a.label}</b><small>{labels[a.action] || a.action}</small></span><small>{dateText(a.created_at)}</small></div>) : <Empty>Событий пока нет</Empty>}</Panel></div>
    <Panel title="Быстрые действия"><div className="quick"><button onClick={()=>open("employee")}><Users size={18}/>Добавить сотрудника</button><button onClick={()=>open("task")}><Plus size={18}/>Создать задачу</button><button onClick={()=>open("project")}><FolderKanban size={18}/>Создать проект</button></div></Panel>
  </>;
}

function HR({data,people,requests,notes,open,departmentId}:Props) {
  const c=data.counts, scope = departmentId ? new Set(people.filter(p=>p.department_id===Number(departmentId)).map(p=>p.id)) : null;
  const visibleRequests = scope ? requests.filter(r=>scope.has(r.user_id)) : requests;
  return <>
    <div className="stats">
      <Metric href={"/employees?scope=all"+filter(departmentId)} title="Штат" value={c.employees} detail={c.working+" на смене"} icon={<Users/>}/>
      <Metric href={"/requests?status=PENDING"+filter(departmentId)} title="На согласовании" value={c.pending} icon={<ClipboardList/>} color="violet"/>
      <Metric href="/absences" title="Сегодня в отпуске" value={c.leave} icon={<CalendarDays/>} color="green"/>
      <Metric href="/absences" title="Отсутствуют сегодня" value={c.absent} icon={<Clock3/>}/>
    </div>
    <div className="work-grid"><Panel title="Очередь согласования" action={all("/requests?status=PENDING","Открыть очередь")}><RequestRows rows={visibleRequests.filter(r=>r.status==="PENDING").slice(0,5)} people={people}/></Panel><Panel title="Сотрудники по отделам"><DepartmentRows data={data}/></Panel></div>
    <div className="work-grid"><Panel title="Календарь отсутствий" action={all("/absences","Открыть календарь")}><Absences data={data} people={people}/></Panel><Panel title="Рабочий статус" action={all("/schedule","График смен")}><div className="staff-overview">{["WORKING","ABSENT","OFF"].map(s=><div key={s}><strong>{data.staff_status?.[s] || 0}</strong><span>{labels[s]}</span></div>)}</div></Panel></div>
    <div className="work-grid"><Panel title="Последние заявления" action={all("/requests","Все заявления")}><RequestRows rows={visibleRequests.slice(0,4)} people={people}/></Panel><Panel title="Кадровые события"><NoteRows notes={notes}/></Panel></div>
    <Panel title="Быстрые действия HR"><div className="quick"><button onClick={()=>open("employee")}><Plus size={18}/>Добавить сотрудника</button><Link href="/employees"><Users size={18}/>Найти сотрудника</Link><Link href="/requests?status=PENDING"><ClipboardList size={18}/>Открыть заявления</Link><Link href="/schedule"><CalendarDays size={18}/>График смен</Link><Link href="/structure"><Layers3 size={18}/>Перейти к отделам</Link></div></Panel>
  </>;
}

function Manager({data,people,open,dateStart,dateEnd}:Props) {
  const c=data.counts;
  return <>
    <div className="stats">
      <Metric href="/employees" title="Команда" value={c.employees} detail={c.absent+" отсутствуют сегодня"} icon={<Users/>}/>
      <Metric href="/tasks?status=active" title="Активные задачи" value={c.active} detail={c.today+" со сроком сегодня"} icon={<CheckSquare/>}/>
      <Metric href="/tasks?due=overdue" title="Просроченные" value={c.overdue} icon={<AlertTriangle/>} color="red"/>
      <Metric href={"/tasks?from="+dateStart+"&to="+dateEnd} title="Выполнение плана" value={c.completion+"%"} detail={c.finished+" из "+c.planned+" в периоде"} icon={<Activity/>} color="green"/>
    </div>
    <div className="work-grid"><Panel title="Нагрузка команды" action={all("/employees","Моя команда")}>{data.workload?.length ? [...data.workload].sort((a,b)=>b.active-a.active).slice(0,8).map(p=><div className="work-row" key={p.id}><Link href={"/employees/"+p.id} className="work-title"><Avatar name={p.name}/><span><b>{p.name}</b><small>{labels[p.status]}</small></span></Link><small>Задач: {p.active}</small></div>) : <Empty/>}</Panel><Panel title="Выполнение задач команды"><TrendChart data={data}/></Panel></div>
    <div className="work-grid"><Panel title="Задачи на сегодня" action={all("/tasks?due=today","Открыть задачи")}><TaskRows items={data.due_today}/></Panel><Panel title="Ближайшие сроки" action={all("/tasks?due=upcoming","Все сроки")}><TaskRows items={data.upcoming}/></Panel></div>
    <div className="work-grid"><Panel title="Проекты команды" action={all("/projects","Все проекты")}><ProjectTable projects={data.projects.slice(0,5)}/></Panel><Panel title="График команды" action={all("/schedule","Открыть график")}><p className="panel-summary">Смен на ближайшие 7 дней: <b>{data.team_shifts?.length || 0}</b></p><Absences data={data} people={people} generic/></Panel></div>
    <Panel title="Быстрые действия"><div className="quick"><button onClick={()=>open("task")}><Plus size={18}/>Создать и назначить задачу</button><Link href="/projects"><FolderKanban size={18}/>Открыть проект</Link><Link href="/employees"><Users size={18}/>Посмотреть команду</Link></div></Panel>
  </>;
}

function NoteRows({notes}: {notes:Note[]}) {
  return notes.length ? notes.slice(0,4).map(n=><div key={n.id} className="work-row"><span className="work-title"><span className="tile"><Bell size={17}/></span><span><b>{n.message}</b><small>{dateText(n.created_at)}</small></span></span>{!n.read && <span className="unread-dot" aria-label="Непрочитано"/>}</div>) : <Empty>Уведомлений пока нет</Empty>;
}

function EmployeeWorkspace({data,user,requests,notes,department,open}:Props) {
  const c=data.counts;
  return <>
    <section className="panel identity"><Avatar name={user.name}/><div><h2>{user.name}</h2><p>{[user.position,department,user.manager && "Руководитель — " + user.manager].filter(Boolean).join(" · ")}</p></div><Badge value={data.working_status}/>{all("/profile","Мой профиль")}</section>
    <div className="stats">
      <Metric href="/tasks?status=active" title="Мои активные задачи" value={c.active} detail={c.today+" со сроком сегодня"} icon={<BriefcaseBusiness/>}/>
      <Metric href="/tasks?status=COMPLETED" title="Выполнено" value={c.completed} color="green" icon={<CheckSquare/>}/>
      <Metric href="/requests" title="Остаток отпуска" value={user.leave_days+" дн."} color="violet" icon={<CalendarDays/>}/>
      <Metric href="/schedule" title="Ближайшая смена" value={data.next_shift ? dateText(data.next_shift.day) : "—"} detail={data.next_shift ? labels[data.next_shift.kind] : undefined} icon={<Clock3/>}/>
    </div>
    <div className="work-grid"><Panel title="Мои задачи на сегодня" action={all("/tasks?due=today","Мои задачи")}><TaskRows items={data.due_today}/></Panel><Panel title="Сегодня в графике" action={all("/schedule","Мой график")}><div className="shift-spotlight"><CalendarDays size={28}/><div><b>{dateText(data.today)}</b><p>{data.working_status==="ABSENT" ? "Подтверждённое отсутствие" : data.today_shift ? labels[data.today_shift.kind] : "Смена не назначена"}</p></div></div></Panel></div>
    <div className="work-grid"><Panel title="Ближайшие дедлайны"><TaskRows items={data.upcoming}/></Panel><Panel title="Мои заявления" action={all("/requests","История заявлений")}><RequestRows rows={requests.slice(0,4)}/></Panel></div>
    <div className="work-grid"><Panel title="Мои проекты" action={all("/projects","Доступные проекты")}><ProjectTable projects={data.projects.slice(0,4)}/></Panel><Panel title="Личная активность"><NoteRows notes={notes}/></Panel></div>
    <Panel title="Быстрые действия"><div className="quick"><button onClick={()=>open("LEAVE")}><CalendarDays size={18}/>Подать заявление на отпуск</button><button onClick={()=>open("SICK")}><ClipboardList size={18}/>Загрузить больничный</button><Link href="/tasks"><CheckSquare size={18}/>Открыть задачи</Link><Link href="/profile"><ChevronRight size={18}/>Открыть профиль</Link></div></Panel>
  </>;
}

export default function RoleDashboard(props:Props) {
  const Content = {DIRECTOR:Director, HR, MANAGER:Manager, EMPLOYEE:EmployeeWorkspace}[props.user.role];
  return <Content {...props}/>;
}
