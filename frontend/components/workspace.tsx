"use client";

import { Suspense, useCallback, useEffect, useState, type FormEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { Bell, Building2, CalendarDays, CheckSquare, ChevronDown, ClipboardList, FolderKanban, LayoutDashboard, LogOut, Menu, Moon, Network, Plus, Search, Sun, Users, X } from "lucide-react";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { api, dateKey, dateText, labels, offset, type Department, type Employee, type Note, type Overview, type Project, type RequestRow, type Task, type User } from "./data";
import { Avatar, Dialog, Empty, Field, Loading } from "./ui";
import RoleDashboard from "./role-dashboard";
import { Section } from "./sections";
import { Editor } from "./editor";

const menu = [
  ["/", "Обзор", LayoutDashboard], ["/employees", "Сотрудники", Users], ["/projects", "Проекты", FolderKanban],
  ["/tasks", "Задачи", CheckSquare], ["/requests", "Заявления", ClipboardList],
  ["/schedule", "График смен", CalendarDays], ["/structure", "Оргструктура", Network],
] as const;
const roleNav: Record<User["role"], [string,string][]> = {
  DIRECTOR:[["/","Обзор"],["/employees","Сотрудники"],["/projects","Проекты"],["/tasks","Задачи"],["/requests","Заявления"],["/schedule","График смен"],["/structure","Оргструктура"]],
  HR:[["/","Панель HR"],["/employees","Сотрудники"],["/requests","Заявления"],["/absences","Отпуска и отсутствия"],["/schedule","График смен"],["/structure","Оргструктура"],["/projects","Проекты"],["/tasks","Задачи"]],
  MANAGER:[["/","Обзор команды"],["/employees","Моя команда"],["/projects","Проекты"],["/tasks","Задачи"],["/schedule","График команды"],["/requests","Мои заявления"],["/structure","Оргструктура"]],
  EMPLOYEE:[["/","Мой обзор"],["/tasks","Мои задачи"],["/schedule","Мой график"],["/requests","Мои заявления"],["/projects","Доступные проекты"],["/profile","Мой профиль"]],
};
const workspaceSubtitle = {DIRECTOR:"Операционная сводка компании", HR:"Кадровые процессы, график и согласования", MANAGER:"Сроки, задачи и загрузка команды", EMPLOYEE:"Ваши задачи, заявления и рабочий график"};
const welcome = {DIRECTOR:"Панель директора", HR:"Панель HR", MANAGER:"Панель руководителя", EMPLOYEE:"Личный кабинет"};
const loginSchema = z.object({email:z.string().email("Введите корректный email"),password:z.string()});

function Brand() {
  return <div className="brand"><span className="brand-mark"><i/><i/></span><div><b>Enterprise OS</b><small>Рабочее пространство</small></div></div>;
}

function SignIn({done, theme, toggle}: {done:()=>void; theme: string; toggle:()=>void}) {
  const [mode,setMode] = useState<"login"|"recover"|"reset">("login");
  const [token,setToken] = useState("");
  const [error,setError] = useState("");
  const [message,setMessage] = useState("");
  const {register,handleSubmit,formState:{errors,isSubmitting}} = useForm<z.infer<typeof loginSchema>>({resolver:zodResolver(loginSchema),defaultValues:{email:"",password:""}});
  useEffect(() => {
    const key = new URLSearchParams(window.location.hash.slice(1)).get("reset");
    if (key) {setMode("reset"); setToken(key); window.history.replaceState(null,"",window.location.pathname);}
  }, []);
  async function send(email:string,password:string) {
    setError(""); setMessage("");
    try {
      if (mode === "login") { await api("/auth/login","POST",{email,password}); done(); }
      if (mode === "recover") { await api("/auth/recover","POST",{email}); setMessage("Если учётная запись существует, проверьте почту."); }
      if (mode === "reset") { await api("/auth/reset","POST",{token,password}); setMode("login"); setMessage("Пароль изменён. Войдите с новым паролем."); }
    } catch (e) {setError((e as Error).message);}
  }
  return <main className="login"><button className="icon login-theme" onClick={toggle} aria-label="Сменить тему">{theme === "light" ? <Moon/> : <Sun/>}</button>
    <section className="login-card"><Brand/><h1>{mode === "login" ? "Вход в систему" : mode === "recover" ? "Восстановление доступа" : "Новый пароль"}</h1>
      <form onSubmit={mode === "reset" ? (e:FormEvent<HTMLFormElement>) => {e.preventDefault(); void send("",String(new FormData(e.currentTarget).get("new")));} : handleSubmit(v => send(v.email,v.password))}>
        {mode !== "reset" && <Field label="Email"><input {...register("email")} type="email" autoComplete="username" required/></Field>}
        {mode === "login" && <Field label="Пароль"><input {...register("password")} type="password" autoComplete="current-password" required/></Field>}
        {mode === "reset" && <Field label="Новый пароль"><input name="new" type="password" autoComplete="new-password" minLength={12} maxLength={128} required/></Field>}
        {(error || errors.email) && <p className="error" role="alert">{error || errors.email?.message}</p>}{message && <p role="status">{message}</p>}
        <button className="primary" disabled={isSubmitting}>{mode === "login" ? "Войти" : mode === "recover" ? "Отправить ссылку" : "Сохранить пароль"}</button>
      </form><button className="text-link" onClick={() => {setMode(mode === "login" ? "recover" : "login");setError("");setMessage("");}}>{mode === "login" ? "Забыли пароль?" : "Вернуться ко входу"}</button>
    </section></main>;
}

export default function Workspace() {
  const path = usePathname();
  const router = useRouter();
  const parts = path.split("/").filter(Boolean);
  const section = parts[0] || "";
  const id = Number(parts[1] || 0);
  const [user,setUser] = useState<User|null|undefined>(undefined);
  const [error,setError] = useState("");
  const [boot,setBoot] = useState("");
  const [theme,setTheme] = useState("dark");
  const [sidebar,setSidebar] = useState(false);
  const [popup,setPopup] = useState("");
  const [editor,setEditor] = useState("");
  const [editRow,setEditRow] = useState<RequestRow>();
  const [revision,setRevision] = useState(0);
  const [people,setPeople] = useState<Employee[]>([]);
  const [departments,setDepartments] = useState<Department[]>([]);
  const [projects,setProjects] = useState<Project[]>([]);
  const [tasks,setTasks] = useState<Task[]>([]);
  const [requests,setRequests] = useState<RequestRow[]>([]);
  const [notes,setNotes] = useState<Note[]>([]);
  const [overview,setOverview] = useState<Overview>();
  const [query,setQuery] = useState("");
  const [selection,setSelection] = useState(0);
  const [overviewKey,setOverviewKey] = useState("");
  const [overviewError,setOverviewError] = useState("");

  const [end,setEnd] = useState("");
  const [start,setStart] = useState("");
  const [department,setDepartment] = useState("");
  const loadUser = useCallback(async () => {
    setBoot("");
    try {setUser(await api<User>("/me"));} catch (e) {
      if ((e as Error).message === "Войдите в систему") setUser(null);
      else {setBoot((e as Error).message);setUser(undefined);}
    }
  },[]);
  useEffect(() => {
    void loadUser();
    setTheme(localStorage.getItem("enterprise-theme") === "light" ? "light" : "dark");
    const expired = () => {setUser(null);setEditor("");setPopup("");};
    window.addEventListener("session-expired",expired);
    return () => window.removeEventListener("session-expired",expired);
  },[loadUser]);
  useEffect(() => {document.documentElement.dataset.theme = theme;},[theme]);
  const toggle = () => {const value = theme === "light" ? "dark" : "light"; localStorage.setItem("enterprise-theme",value);setTheme(value);};
  const userId = user?.id;
  const filtersKey = [userId,start,end,department,revision].join("|");
  useEffect(() => {
    if (!userId) return;
    let active = true;
    const load = async () => {
      try {
        const notifications = api("/notifications/deadlines","POST").then(() => api<Note[]>("/notifications"));
        const [a,b,c,d,e,f] = await Promise.all([api<Employee[]>("/employees"),api<Department[]>("/departments"),api<Project[]>("/projects"),api<Task[]>("/tasks"),api<RequestRow[]>("/requests"),notifications]);
        if (active) {setPeople(a);setDepartments(b);setProjects(c);setTasks(d);setRequests(e);setNotes(f);setError("");}
      } catch (e) {if (active) setError((e as Error).message);}
    };
    void load();
    return () => {active = false;};
  }, [userId,revision]);
  useEffect(() => {
    if (!userId || section) return;
    let active = true;
    const filters = new URLSearchParams();
    filters.set("end",end || dateKey());
    filters.set("start",start || offset(dateKey(),-29));
    if (department) filters.set("department",department);
    void api<Overview>("/overview?" + filters).then(r => {
      if (active) { setOverview(r); setOverviewError(""); setOverviewKey(filtersKey); }
    }).catch(e => {
      if (active) { setOverview(undefined); setOverviewError(e.message); setOverviewKey(filtersKey); }
    });
    return () => {active = false;};
  },[userId,section,start,end,department,filtersKey]);
  useEffect(() => {setSidebar(false);setPopup("");setQuery("");},[path]);
  useEffect(() => {
    const keyboard = (event:KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {event.preventDefault();document.getElementById("search")?.focus();}
      if (event.key === "Escape") setPopup("");
    };
    window.addEventListener("keydown",keyboard);
    return () => window.removeEventListener("keydown",keyboard);
  },[]);
  function refresh() {setRevision(r => r + 1);void loadUser();}
  function open(kind: string, row?: RequestRow) {setEditRow(row);setEditor(kind);setPopup("");}
  if (boot) return <main className="login"><section className="login-card"><Brand/><p role="alert">{boot}</p><button className="primary" onClick={loadUser}>Повторить</button></section></main>;
  if (user === undefined) return <Loading/>;
  if (!user) return <SignIn done={() => {setOverview(undefined);setPeople([]);setProjects([]);setTasks([]);setRequests([]);setNotes([]);setDepartments([]);setStart("");setEnd("");setDepartment("");refresh();router.replace("/");}} theme={theme} toggle={toggle}/>;
  const director = user.role === "DIRECTOR";
  const hr = user.role === "HR";
  const manager = user.role === "MANAGER";
  const nav = roleNav[user.role];
  const unread = notes.filter(n => !n.read).length;
  const needle = query.trim().toLocaleLowerCase("ru");
  const results = needle ? [...tasks.map(t => [t.name,"/tasks/" + t.id,"Задача"]),...projects.map(p => [p.name,"/projects/" + p.id,"Проект"]),...people.map(p => [p.name,"/employees/" + p.id,"Сотрудник"])].filter(([name]) => name.toLocaleLowerCase("ru").includes(needle)) : [];
  const currentLabel = nav.find(([href]) => href === "/" + section)?.[1] || menu.find(([href]) => href === "/" + section)?.[1];
  const groups = ["Задача","Проект","Сотрудник"].map(kind => [kind, results.filter(row=>row[2]===kind).slice(0,4)] as const);
  const ordered = groups.flatMap(([,rows])=>rows);
  return <div className="app-shell">
    {sidebar && <button className="scrim" aria-label="Закрыть меню" onClick={() => setSidebar(false)}/>}
    <aside className={"sidebar " + (sidebar ? "sidebar-open" : "")}><Link href="/" aria-label="Enterprise OS — обзор"><Brand/></Link>
      <nav aria-label="Разделы"><p className="nav-label">РАБОЧАЯ ОБЛАСТЬ</p>{nav.map(([href,name]) => {
        const Icon = menu.find(([key])=>key===href)?.[2] || (href === "/profile" ? Users : CalendarDays);
        return <Link key={href} href={href} className={href === "/" + section ? "active" : ""} aria-current={href === "/" + section ? "page" : undefined}><Icon size={19}/><span>{name}</span>{href === "/requests" && hr && requests.filter(r=>r.status === "PENDING").length > 0 && <small>{requests.filter(r=>r.status === "PENDING").length}</small>}</Link>;
      })}</nav>
      <div className="company"><span className="tile blue"><Building2 size={20}/></span><div><strong>{user.company}</strong><small>{user.demo ? "Демонстрационная компания" : "Рабочее пространство"}</small></div></div>
    </aside>
    <header className="topbar"><button className="icon mobile-menu" aria-label="Меню" onClick={() => setSidebar(!sidebar)}><Menu size={21}/></button>
      <div className="search-wrap"><label className="search"><Search size={19}/><input id="search" placeholder="Поиск задач, проектов и сотрудников" aria-label="Глобальный поиск" value={query} onFocus={() => setPopup("search")} onChange={e => {setQuery(e.target.value);setSelection(0);setPopup("search");}}
          onKeyDown={e => {
            if (!ordered.length) return;
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault(); setSelection(index => (index + (e.key === "ArrowDown" ? 1 : -1) + ordered.length) % ordered.length);
            }
            if (e.key === "Enter" && popup === "search") {
              e.preventDefault(); router.push(ordered[selection]?.[1] || ordered[0][1]);setPopup("");setQuery("");
            }
          }}/><kbd>Ctrl K</kbd></label>
        {popup === "search" && needle && <div className="popover search-results">{ordered.length ? groups.map(([kind,rows]) => rows.length > 0 && <div className="search-group" key={kind}><small>{kind}</small>{rows.map(row => <Link key={row[1]} href={row[1]} className={ordered[selection] === row ? "search-active" : ""} onClick={() => {setPopup("");setQuery("");}}>{row[0]}</Link>)}</div>) : <Empty>Совпадений нет</Empty>}</div>}
      </div>
      <div className="top-actions">
        <button className="primary create" onClick={() => setPopup(popup === "create" ? "" : "create")} aria-expanded={popup === "create"} aria-label="Создать"><Plus size={18}/><span>Создать</span></button>
        <button className="icon bell" aria-label={unread ? "Уведомления, новых: " + unread : "Уведомления"} onClick={() => setPopup(popup === "notes" ? "" : "notes")} aria-expanded={popup === "notes"}><Bell size={20}/>{unread > 0 && <i/>}</button>
        <button className="icon" aria-label="Сменить тему" onClick={toggle}>{theme === "light" ? <Moon size={19}/> : <Sun size={19}/>}</button>
        <button className="account" onClick={() => setPopup(popup === "user" ? "" : "user")} aria-label="Меню профиля" aria-expanded={popup === "user"}><Avatar name={user.name}/><span><b>{user.name}</b><small>{labels[user.role]}</small></span><ChevronDown size={15}/></button>
        {popup === "create" && <div className="popover">{(director || manager) && <button onClick={() => open("task")}>Новая задача</button>}{director && <button onClick={() => open("project")}>Новый проект</button>}{(director || hr) && <><button onClick={() => open("employee")}>Добавить сотрудника</button><button onClick={() => open("department")}>Создать отдел</button></>}<button onClick={() => open("LEAVE")}>Заявление на отпуск</button><button onClick={() => open("SICK")}>Оформить больничный</button></div>}
        {popup === "notes" && <div className="popover notes"><div className="panel-head"><h2>Уведомления</h2><button className="icon" aria-label="Закрыть" onClick={() => setPopup("")}><X size={17}/></button></div>{notes.length ? notes.map(n => <button key={n.id} disabled={n.read} onClick={async () => {try {await api("/notifications/" + n.id,"PATCH");setNotes(rows => rows.map(item => item.id === n.id ? {...item,read:true} : item));} catch(e) {setError((e as Error).message);}}}>{!n.read && <i/>}<span>{n.message}<small>{dateText(n.created_at)}{!n.read && " · Отметить прочитанным"}</small></span></button>) : <Empty>Нет уведомлений</Empty>}</div>}
        {popup === "user" && <div className="popover"><Link href="/profile">Мой профиль</Link><button onClick={async () => {try {await api("/auth/logout","POST");setPopup("");setUser(null);router.replace("/");} catch(e) {setError((e as Error).message);}}}><LogOut size={17}/>Выйти</button></div>}
      </div>
    </header>
    <main className="content">{error && <div className="error banner" role="alert">{error}<button className="icon" aria-label="Закрыть сообщение" onClick={() => setError("")}><X size={17}/></button></div>}
      {!section ? <><div className="page-head"><div><span className="eyebrow">{welcome[user.role]}</span><h1>Добро пожаловать, {user.name.split(" ")[0]}!</h1><p>{workspaceSubtitle[user.role]}</p></div>
        {user.role !== "EMPLOYEE" && <div className="filters period"><Field label="С"><input type="date" value={start || offset(dateKey(),-29)} max={end || dateKey()} onChange={e => setStart(e.target.value)}/></Field><Field label="По"><input type="date" value={end || dateKey()} min={start || offset(dateKey(),-29)} onChange={e => setEnd(e.target.value)}/></Field>{(director || hr) && <Field label="Отдел"><select value={department} onChange={e => setDepartment(e.target.value)}><option value="">Все отделы</option>{departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>}</div>}
        </div>{overviewKey !== filtersKey ? <div className="stats" role="status" aria-label="Загрузка показателей">{Array.from({length:4},(_,index)=><div className="stat skeleton" key={index}/>)}</div> : overview ? <RoleDashboard user={user} data={overview} requests={requests} people={people} notes={notes} departmentId={department} dateStart={start || offset(dateKey(),-29)} dateEnd={end || dateKey()} department={departments.find(d => d.id === user.department_id)?.name} open={open}/> : <div className="panel" role="alert"><p>{overviewError}</p><button onClick={refresh}>Повторить загрузку</button></div>}</> :
        <><div className="breadcrumbs"><Link href="/">Обзор</Link><span>/</span>{id && currentLabel ? <Link href={"/" + section}>{currentLabel}</Link> : <span>{currentLabel || (section === "profile" ? "Мой профиль" : "Страница")}</span>}</div>
        <Suspense fallback={<Loading/>}><Section key={path} {...{section,id,user,people,departments,projects,tasks,requests,open,refresh,revision}}/></Suspense></>}
    </main>
    {editor && <Dialog title={({LEAVE:"Заявление на отпуск",SICK:"Оформление больничного",task:"Новая задача",employee:"Новый сотрудник",project:"Новый проект",department:"Новый отдел",shift:"Назначение смены"} as Record<string,string>)[editor] || (editor.startsWith("shift:") ? "Изменить смену" : "Редактирование профиля")} close={() => setEditor("")}>
      <Editor kind={editor} row={editRow} user={user} people={people} projects={projects} departments={departments} close={() => setEditor("")} saved={() => {setEditor("");refresh();}}/>
    </Dialog>}
  </div>;
}
