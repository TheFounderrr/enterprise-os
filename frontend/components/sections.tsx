"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode, type FormEvent } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Download, Plus } from "lucide-react";
import { api, dateKey, dateText, labels, offset, statuses, type Department, type Employee, type Event, type Project, type RequestRow, type Schedule, type Task, type User } from "./data";
import { Avatar, Badge, Empty, Field, Loading, Panel, Table } from "./ui";
import { ProjectTable } from "./dashboard";

type Props = {section:string; id:number; user:User; people:Employee[]; departments:Department[]; projects:Project[]; tasks:Task[]; requests:RequestRow[]; open:(kind:string,row?:RequestRow)=>void; refresh:()=>void; revision:number};
type RequestDetail = RequestRow & {comment:string; document:boolean; history:Event[]};

function Header({title,summary,action}: {title:string;summary?:string;action?:ReactNode}) {
  return <div className="page-head"><div><h1>{title}</h1>{summary && <p>{summary}</p>}</div>{action}</div>;
}
const plus = (label:string,click:()=>void) => <button className="primary" onClick={click}><Plus size={18}/>{label}</button>;
const findName = (rows:{id:number;name:string}[],id:number) => rows.find(r => r.id === id)?.name || "—";
const matches = (value:string,query:string) => value.toLocaleLowerCase("ru").includes(query.trim().toLocaleLowerCase("ru"));
const option = (value:string) => <option key={value} value={value}>{labels[value]}</option>;

function useRecord<T>(path:string,revision:number) {
  const [data,setData] = useState<T>();
  const [error,setError] = useState("");
  useEffect(() => {
    let active = true;
    void api<T>(path).then(r => {if(active) {setData(r);setError("");}}).catch(e => {if(active) {setData(undefined);setError(e.message);}});
    return () => {active = false;};
  },[path,revision]);
  return {data,error};
}

function TaskTable({rows,people,projects,quick}: {rows:Task[];people:Employee[];projects:Project[];quick?:(task:Task)=>ReactNode}) {
  return rows.length ? <Table headers={["Задача","Проект","Исполнитель","Приоритет","Срок","Статус"]}>{rows.map(t => <tr key={t.id}>
    <td><Link className="table-link" href={"/tasks/" + t.id}>{t.name}</Link></td><td>{findName(projects,t.project_id)}</td><td>{findName(people,t.user_id)}</td><td><Badge value={t.priority}/></td><td>{dateText(t.deadline)}</td><td>{quick?.(t) || <Badge value={t.status}/>}</td>
  </tr>)}</Table> : <Empty>Задач по выбранным фильтрам нет</Empty>;
}

function History({events}: {events:Event[]}) {
  return <Panel title="История">{events.length ? events.map(e => <div className="timeline" key={e.id}><div><b>{e.detail.author || labels[e.action] || e.action}</b><small>{dateText(e.created_at)}</small></div><p>{e.detail.text || e.detail.reason || (e.detail.status && labels[e.detail.status])}</p></div>) : <Empty>История пока пуста</Empty>}</Panel>;
}

function Detail({props}: {props:Props}) {
  const {section,id,user,people,projects,open,refresh,revision} = props;
  const {data,error} = useRecord<(Task | Project | RequestDetail) & {history?:Event[]; tasks?:Task[]}>("/" + section + "/" + id,revision);
  const [failure,setFailure] = useState("");
  const [pending,setPending] = useState(false);
  async function send(path:string,method:string,data:object,form?:HTMLFormElement) {
    setPending(true);setFailure("");
    try {await api(path,method,data);form?.reset();refresh();} catch (e) {setFailure((e as Error).message);} finally {setPending(false);}
  }
  if (error) return <Empty>{error}</Empty>;
  if (!data) return <Loading/>;
  return <>
    {failure && <p className="error banner" role="alert">{failure}</p>}
    {"kind" in data ? <>
      <Header title={labels[data.kind]} summary={findName(people,data.user_id)} action={<Badge value={data.status}/>}/>
      <Panel title="Сведения о заявлении"><dl className="details"><dt>Период</dt><dd>{dateText(data.start)} — {dateText(data.end)}</dd>{data.subtype && <><dt>Тип отпуска</dt><dd>{labels[data.subtype]}</dd></>}{data.comment && <><dt>Комментарий</dt><dd>{data.comment}</dd></>}</dl>
        {data.document && <a className="button" href={"/api/requests/" + id + "/document"}><Download size={17}/>Скачать документ</a>}
        {data.status === "RETURNED" && data.user_id === user.id && plus("Исправить заявление",() => open(data.kind,data))}
      </Panel>
      {user.role === "HR" && data.user_id !== user.id && data.status === "PENDING" && <Panel title="Решение HR"><form onSubmit={e => {e.preventDefault();const form = e.currentTarget;void send("/requests/" + id + "/decision","POST",Object.fromEntries(new FormData(form)),form);}}>
        <Field label="Решение"><select name="status">{["APPROVED","REJECTED","RETURNED"].map(option)}</select></Field><Field label="Причина решения"><textarea name="reason" maxLength={4000}/></Field><button className="primary" disabled={pending}>Сохранить решение</button>
      </form></Panel>}
      <History events={data.history}/>
    </> : "priority" in data ? <>
      <Header title={data.name} summary={findName(projects,data.project_id)} action={<Badge value={data.status}/>}/>
      <Panel title="Сведения о задаче"><p>{data.description}</p><dl className="details"><dt>Исполнитель</dt><dd>{findName(people,data.user_id)}</dd><dt>Срок</dt><dd>{dateText(data.deadline)}</dd><dt>Приоритет</dt><dd><Badge value={data.priority}/></dd></dl>
        {user.role !== "HR" && !(user.role === "EMPLOYEE" && data.status === "CANCELLED") && <form className="filters" key={data.status} onSubmit={e => {e.preventDefault();void send("/tasks/" + id,"PATCH",Object.fromEntries(new FormData(e.currentTarget)));}}>
          <Field label="Статус"><select name="status" defaultValue={data.status}>{statuses.filter(s=>user.role !== "EMPLOYEE" || s !== "CANCELLED").map(option)}</select></Field><button className="primary" disabled={pending}>Обновить статус</button>
        </form>}
      </Panel>
      <Panel title="Добавить комментарий"><form onSubmit={e => {e.preventDefault();const form=e.currentTarget;void send("/tasks/" + id + "/comments","POST",Object.fromEntries(new FormData(form)),form);}}>
        <Field label="Комментарий"><textarea name="text" required maxLength={4000}/></Field><button className="primary" disabled={pending}>Отправить</button></form></Panel>
      <History events={data.history || []}/>
    </> : <>
      <Header title={data.name} summary={data.description} action={<Badge value={data.status}/>}/>
      <Panel title="Прогресс проекта"><strong className="big">{data.progress}%</strong><div className="progress large"><i style={{width:data.progress + "%"}}/></div><p className="muted">Срок · {dateText(data.deadline)} · Задач: {data.task_count} · Просрочено: {data.overdue_count}</p></Panel>
      <Panel title="Задачи проекта"><TaskTable rows={data.tasks || []} people={people} projects={projects}/></Panel>
      <Panel title="Команда проекта"><div className="people-grid">{Array.from(new Set(data.tasks?.map(t=>t.user_id))).map(member => {
        const person = people.find(p => p.id === member);
        return person ? <Person key={member} person={person} departments={props.departments}/> : null;
      })}</div>{!data.tasks?.length && <Empty>Исполнители пока не назначены</Empty>}</Panel>
    </>}
  </>;
}

function Person({person,departments}: {person:Employee;departments:Department[]}) {
  return <Link className="person" href={"/employees/" + person.id}><Avatar name={person.name}/><div><b>{person.name}</b><small>{person.position}</small><small>{findName(departments,person.department_id)}</small></div>{person.working_status && <Badge value={person.working_status}/>}</Link>;
}

function ScheduleView({user,people,open,revision,absenceOnly}:Props & {absenceOnly?:boolean}) {
  function currentWeek() {
    const day = dateKey();
    const weekday = new Date(day+"T12:00:00Z").getUTCDay();
    return offset(day,-((weekday + 6) % 7));
  }
  const [start,setStart] = useState(currentWeek);
  const [selected,setSelected] = useState("");
  const end = offset(start,6);
  const {data,error} = useRecord<Schedule>("/schedule?start=" + start + "&end=" + end,revision);
  const days = Array.from({length:7},(_,index) => offset(start,index));
  const roster = people.filter(p => !selected || p.id === Number(selected));
  const shifts = new Map(data?.shifts.map(s=>[s.user_id+":"+s.day,s]));
  const absences = new Map<number,Schedule["absences"]>();
  for (const row of data?.absences || []) {
    const assigned = absences.get(row.user_id) || [];
    assigned.push(row);absences.set(row.user_id,assigned);
  }
  return <><Header title={absenceOnly ? "Отпуска и отсутствия" : user.role==="EMPLOYEE" ? "Мой график" : user.role==="MANAGER" ? "График команды" : "График смен"} summary={absenceOnly ? "Подтверждённые отсутствия по дням" : "Смены и подтверждённые отсутствия"} action={!absenceOnly && user.role !== "EMPLOYEE" && plus("Назначить смену",() => open("shift"))}/>
    <Panel title="Расписание на неделю"><div className="filters">
      <button className="icon" aria-label="Предыдущая неделя" onClick={() => setStart(offset(start,-7))}><ChevronLeft size={20}/></button>
      <Field label="Начало недели"><input type="date" value={start} onChange={e => e.target.value && setStart(e.target.value)}/></Field>
      <button className="icon" aria-label="Следующая неделя" onClick={() => setStart(offset(start,7))}><ChevronRight size={20}/></button>
      <button onClick={() => setStart(currentWeek())}>Текущая неделя</button>
      {user.role !== "EMPLOYEE" && <Field label="Сотрудник"><select value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Все сотрудники</option>{people.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>}
    </div>
    {error ? <Empty>{error}</Empty> : !data ? <Loading/> : <Table headers={["Сотрудник",...days.map(dateText)]}>{roster.map(p=><tr key={p.id}>
      <td><span className="project-link"><Avatar name={p.name}/><b>{p.name}</b></span></td>{days.map(day=>{
        const absent = absences.get(p.id)?.find(a=>a.start<=day && day<=a.end);
        const shift = shifts.get(p.id+":"+day);
        return <td key={day}>{absent ? <Badge value={absent.kind === "LEAVE" ? "LEAVE" : "ABSENT"}/> : !absenceOnly && user.role !== "EMPLOYEE" ? <button className="shift-cell" onClick={()=>open("shift:"+p.id+":"+day+":"+(shift?.kind || "DAY"))} aria-label={p.name+", "+dateText(day)+": "+(shift ? labels[shift.kind] : "назначить смену")}>{shift ? <Badge value={shift.kind}/> : "+"}</button> : !absenceOnly && shift ? <Badge value={shift.kind}/> : "—"}</td>;
      })}</tr>)}</Table>}</Panel></>;
}

function Profile({user,departments,refresh}:Props) {
  const [message,setMessage] = useState("");
  const [error,setError] = useState("");
  async function save(e:FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");setMessage("");
    try {await api("/me","PATCH",Object.fromEntries(new FormData(e.currentTarget)));refresh();setMessage("Профиль обновлён.");} catch(e) {setError((e as Error).message);}
  }
  return <><Header title="Мой профиль"/><Panel title="Контактные данные"><div className="profile-head"><Avatar name={user.name}/><div><h2>{user.name}</h2><p>{user.position} · {findName(departments,user.department_id)}</p></div></div>
    <form onSubmit={save}><Field label="Email"><input value={user.email} readOnly/></Field><Field label="Телефон"><input type="tel" name="phone" maxLength={40} defaultValue={user.phone}/></Field>
    {error && <p className="error" role="alert">{error}</p>}{message && <p role="status">{message}</p>}<button className="primary">Сохранить профиль</button></form></Panel></>;
}

export function Section(props:Props) {
  const search = useSearchParams();
  return <SectionContent key={search.toString()} {...props} params={search}/>;
}

function SectionContent(props:Props & {params: Pick<URLSearchParams,"get">}) {
  const {section,id,user,people,departments,projects,tasks,requests,open} = props;
  const [query,setQuery] = useState("");
  const [filter,setFilter] = useState(props.params.get("status") || (section === "employees" ? props.params.get("department") || "" : ""));
  const [secondary,setSecondary] = useState("");
  const [assignee,setAssignee] = useState("");
  const [priority,setPriority] = useState("");
  const [mode,setMode] = useState(section === "projects" ? "cards" : "list");
  const [sort,setSort] = useState("");
  const [employeeStatus,setEmployeeStatus] = useState("");
  const [departmentFilter,setDepartmentFilter] = useState(props.params.get("department") || "");
  const [due,setDue] = useState(props.params.get("due") || "");
  const [from,setFrom] = useState(props.params.get("from") || "");
  const [to,setTo] = useState(props.params.get("to") || "");
  const [failure,setFailure] = useState("");
  const [updating,setUpdating] = useState<number>();
  const [page,setPage] = useState(0);
  const peopleById = new Map(people.map(p=>[p.id,p]));
  async function updateTask(id:number,status:string) {
    setUpdating(id);setFailure("");
    try {await api("/tasks/"+id,"PATCH",{status});props.refresh();}
    catch (error) {setFailure((error as Error).message);}
    finally {setUpdating(undefined);}
  }
  const director = user.role === "DIRECTOR";
  const hr = user.role === "HR";
  const coordinator = director || user.role === "MANAGER";
  if (id && ["tasks","projects","requests"].includes(section)) return <Detail props={props}/>;
  if (section === "profile") return <Profile {...props}/>;
  if (section === "schedule") return <ScheduleView {...props}/>;
  if (section === "absences") return hr ? <ScheduleView {...props} absenceOnly/> : <Empty>Раздел недоступен</Empty>;
  if (section === "projects") {
    const rows = projects.filter(p => matches(p.name + " " + p.description,query) &&
      (!departmentFilter || p.department_id===Number(departmentFilter)) &&
      (!filter || (filter==="active" ? p.status!=="DONE" : p.status===filter)));
    return <><Header title="Проекты" summary="Прогресс, участники и сроки" action={director && plus("Создать проект",() => open("project"))}/>
      <Panel title="Каталог проектов" action={<div className="tabs">{[["cards","Карточки"],["list","Таблица"]].map(([key,label])=><button aria-pressed={mode===key} className={mode===key?"selected":""} key={key} onClick={()=>setMode(key)}>{label}</button>)}</div>}>
        <div className="filters"><Field label="Поиск"><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Название проекта"/></Field><Field label="Статус"><select value={filter} onChange={e=>setFilter(e.target.value)}><option value="">Все статусы</option><option value="active">Активные</option>{["ON_TRACK","RISK","LATE","DONE"].map(option)}</select></Field>
          <Field label="Отдел"><select value={departmentFilter} onChange={e=>setDepartmentFilter(e.target.value)}><option value="">Все отделы</option>{departments.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></Field></div>
        {rows.length === 0 ? <Empty>Проекты по выбранным фильтрам не найдены</Empty> : mode === "list" ? <ProjectTable projects={rows} people={people}/> : <div className="project-catalog">{rows.map(p=><Link key={p.id} className="project-card" href={"/projects/"+p.id}><div className="panel-head"><h3>{p.name}</h3><Badge value={p.status}/></div><p>{p.description}</p><div className="project-progress"><div className="progress"><i style={{width:p.progress+"%"}}/></div><b>{p.progress}%</b></div><dl className="details"><dt>Срок</dt><dd>{dateText(p.deadline)}</dd><dt>Задачи</dt><dd>{p.task_count} · просрочено {p.overdue_count}</dd><dt>Исполнители</dt><dd>{p.assignee_ids.map(id=>peopleById.get(id)?.name).filter(Boolean).join(", ") || "—"}</dd></dl></Link>)}</div>}
      </Panel></>;
  }
  if (section === "tasks") {
    const day = dateKey();
    const isActive = (t:Task) => t.status !== "COMPLETED" && t.status !== "CANCELLED";
    const dueView = (t:Task) => !due || isActive(t) && (due === "overdue" ? t.deadline < day : due === "today" ? t.deadline === day : t.deadline >= day);
    const rows = tasks.filter(t => matches(t.name + " " + t.description,query) &&
      (!filter || (filter === "active" ? isActive(t) : t.status === filter)) &&
      (!secondary || t.project_id === Number(secondary)) && (!assignee || t.user_id === Number(assignee)) &&
      (!priority || t.priority === priority) && (!departmentFilter || peopleById.get(t.user_id)?.department_id === Number(departmentFilter)) &&
      dueView(t) && (!from || t.deadline >= from) && (!to || t.deadline <= to) && (!(from || to) || t.status !== "CANCELLED"));
    const priorities:Record<string,number> = {HIGH:0,MEDIUM:1,LOW:2};
    rows.sort((a,b)=>sort==="name" ? a.name.localeCompare(b.name,"ru") : sort==="priority" ? priorities[a.priority]-priorities[b.priority] || a.deadline.localeCompare(b.deadline) : a.deadline.localeCompare(b.deadline));
    return <><Header title={user.role === "EMPLOYEE" ? "Мои задачи" : "Задачи"} summary="Назначение задач и контроль сроков" action={coordinator && plus("Создать задачу",() => open("task"))}/>
      <Panel title="Рабочие задачи" action={<div className="tabs">{[["list","Список"],["board","Доска"]].map(([key,name]) => <button key={key} className={mode===key ? "selected" : ""} onClick={()=>setMode(key)}>{name}</button>)}</div>}>
        <div className="filters"><Field label="Поиск"><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Название задачи"/></Field>
        <Field label="Статус"><select value={filter} onChange={e=>setFilter(e.target.value)}><option value="">Все статусы</option><option value="active">Активные</option>{statuses.map(option)}</select></Field>
        <Field label="Проект"><select value={secondary} onChange={e=>setSecondary(e.target.value)}><option value="">Все проекты</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        {user.role !== "EMPLOYEE" && <Field label="Исполнитель"><select value={assignee} onChange={e=>setAssignee(e.target.value)}><option value="">Все исполнители</option>{people.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>}
        <Field label="Приоритет"><select value={priority} onChange={e=>setPriority(e.target.value)}><option value="">Все приоритеты</option>{["LOW","MEDIUM","HIGH"].map(option)}</select></Field>
        <Field label="Срок"><select value={due} onChange={e=>setDue(e.target.value)}><option value="">Все сроки</option><option value="today">Сегодня</option><option value="overdue">Просроченные</option><option value="upcoming">Ближайшие</option></select></Field>
        <Field label="Сортировка"><select value={sort} onChange={e=>setSort(e.target.value)}><option value="">По сроку</option><option value="priority">По приоритету</option><option value="name">По названию</option></select></Field>
        {(director || hr) && <Field label="Отдел"><select value={departmentFilter} onChange={e=>setDepartmentFilter(e.target.value)}><option value="">Все отделы</option>{departments.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>}
        {(from || to) && <button onClick={()=>{setFrom("");setTo("");}}>Сбросить период</button>}</div>
        {failure && <p className="error" role="alert">{failure}</p>}
        {mode === "list" ? <TaskTable rows={rows} people={people} projects={projects} quick={t=>user.role !== "HR" && !(user.role==="EMPLOYEE" && t.status==="CANCELLED") ? <select aria-label={"Статус задачи «"+t.name+"»"} disabled={updating!==undefined} value={t.status} onChange={e=>void updateTask(t.id,e.target.value)}>{statuses.filter(s=>user.role!=="EMPLOYEE" || s!=="CANCELLED").map(option)}</select> : <Badge value={t.status}/>}/> : <div className="board">{statuses.filter(s=>!filter || filter===s || filter==="active" && !["COMPLETED","CANCELLED"].includes(s)).map(s=><div key={s}><h3>{labels[s]}</h3>{rows.filter(t=>t.status===s).map(t=><Link className="board-card" key={t.id} href={"/tasks/" + t.id}><b>{t.name}</b><small>{dateText(t.deadline)}</small><Badge value={t.priority}/></Link>)}</div>)}</div>}
      </Panel></>;
  }
  if (section === "requests") {
    const rows = requests.filter(r => (!filter || r.status === filter) && (!secondary || r.kind === secondary) && matches(findName(people,r.user_id),query) && (!departmentFilter || peopleById.get(r.user_id)?.department_id===Number(departmentFilter)));
    return <><Header title={hr ? "Заявления сотрудников" : "Мои заявления"} summary={hr ? "Очередь согласований и история" : "Отпуска, больничные и история решений"}
      action={<div className="actions">{plus("Подать отпуск",()=>open("LEAVE"))}<button onClick={()=>open("SICK")}><CalendarDays size={17}/>Оформить больничный</button></div>}/>
      <Panel title={hr ? "Все заявления" : "История заявлений"}><div className="filters">
        {hr && <><Field label="Сотрудник"><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Имя сотрудника"/></Field><Field label="Отдел"><select value={departmentFilter} onChange={e=>setDepartmentFilter(e.target.value)}><option value="">Все отделы</option>{departments.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></Field></>}
        <Field label="Тип"><select value={secondary} onChange={e=>setSecondary(e.target.value)}><option value="">Все типы</option>{["LEAVE","SICK"].map(option)}</select></Field>
        <Field label="Статус"><select value={filter} onChange={e=>setFilter(e.target.value)}><option value="">Все статусы</option>{["PENDING","APPROVED","REJECTED","RETURNED"].map(option)}</select></Field></div>
        {rows.length ? <Table headers={["Сотрудник","Заявление","Период","Статус"]}>{rows.map(r=><tr key={r.id}><td>{findName(people,r.user_id)}</td><td><Link className="table-link" href={"/requests/"+r.id}>{labels[r.kind]}</Link></td><td>{dateText(r.start)} — {dateText(r.end)}</td><td><Badge value={r.status}/></td></tr>)}</Table> : <Empty>Заявлений по выбранным фильтрам нет</Empty>}
      </Panel></>;
  }
  if (section === "employees" && id) {
    const person = people.find(p=>p.id===id);
    return person ? <><Header title={person.name} summary={person.position} action={(director || hr) && person.id !== user.id && person.role !== "DIRECTOR" && !(hr && person.role === "HR") && plus("Редактировать профиль",() => open("employee:" + person.id))}/><Panel title="Рабочий профиль"><div className="profile-head"><Avatar name={person.name}/><Badge value={person.role}/></div><dl className="details"><dt>Отдел</dt><dd>{findName(departments,person.department_id)}</dd><dt>Руководитель</dt><dd>{person.id===user.id ? user.manager || "—" : findName(people,person.manager_id || 0)}</dd><dt>Рабочий статус</dt><dd>{person.working_status && <Badge value={person.working_status}/>}</dd></dl></Panel></> : <Empty>Профиль недоступен</Empty>;
  }
  if (section === "employees" && user.role !== "EMPLOYEE") {
    const rows = people.filter(p=>matches(p.name + " " + p.position,query) && (!filter || p.department_id===Number(filter)) && (!employeeStatus || p.working_status===employeeStatus));
    rows.sort((a,b)=>sort==="department" ? findName(departments,a.department_id).localeCompare(findName(departments,b.department_id),"ru") : sort==="position" ? a.position.localeCompare(b.position,"ru") : a.name.localeCompare(b.name,"ru"));
    const currentPage = Math.min(page,Math.max(0,Math.ceil(rows.length/24)-1));
    return <><Header title={user.role === "MANAGER" ? "Моя команда" : "Сотрудники"} summary="Рабочие профили и подразделения" action={(director||hr) && plus("Добавить сотрудника",()=>open("employee"))}/>
      <Panel title="Справочник"><div className="filters"><Field label="Поиск"><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Имя или должность"/></Field>
        <Field label="Отдел"><select value={filter} onChange={e=>{setFilter(e.target.value);setPage(0);}}><option value="">Все отделы</option>{departments.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
        <Field label="Рабочий статус"><select value={employeeStatus} onChange={e=>{setEmployeeStatus(e.target.value);setPage(0);}}><option value="">Все статусы</option>{["WORKING","ABSENT","OFF"].map(option)}</select></Field>
        <Field label="Сортировка"><select value={sort} onChange={e=>{setSort(e.target.value);setPage(0);}}><option value="">По имени</option><option value="department">По отделу</option><option value="position">По должности</option></select></Field></div>
        {rows.length ? <div className="people-grid">{rows.slice(currentPage*24,(currentPage+1)*24).map(p=><Person key={p.id} person={p} departments={departments}/>)}</div> : <Empty>Сотрудники не найдены</Empty>}
        {rows.length>24 && <div className="actions pagination"><button disabled={currentPage===0} onClick={()=>setPage(currentPage-1)}>Назад</button><span>{currentPage*24+1}–{Math.min(rows.length,(currentPage+1)*24)} из {rows.length}</span><button disabled={(currentPage+1)*24>=rows.length} onClick={()=>setPage(currentPage+1)}>Далее</button></div>}
      </Panel></>;
  }
  if (section === "structure" && user.role !== "EMPLOYEE") {
    const leader = people.find(p=>p.role==="DIRECTOR") || (user.role === "MANAGER" ? user : undefined);
    return <><Header title="Структура компании" summary="Руководство и подразделения" action={(director||hr) && plus("Создать отдел",()=>open("department"))}/>
      {leader && <div className="org-leader"><Person person={leader} departments={departments}/></div>}
      <div className="org-grid">{departments.map(d=>({d,rows:people.filter(p=>p.department_id===d.id && p.id!==leader?.id)})).filter(({rows})=>rows.length || director || hr).map(({d,rows})=><Panel key={d.id} title={d.name} action={<span className="muted">{rows.length}</span>}>{rows.length ? <details className="org-details" open={rows.length < 5}><summary>Сотрудники отдела</summary>{[...rows].sort((a,b)=>Number(b.role==="MANAGER")-Number(a.role==="MANAGER")).map(p=><div key={p.id}><Person person={p} departments={departments}/>{p.manager_id && <small className="org-manager">Руководитель: {findName(people,p.manager_id)}</small>}</div>)}</details> : <Empty>Нет сотрудников</Empty>}</Panel>)}</div></>;
  }
  return <Empty>Раздел недоступен</Empty>;
}
