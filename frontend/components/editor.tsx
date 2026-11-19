"use client";

import { useEffect, useState, type FormEvent } from "react";
import { UploadCloud } from "lucide-react";
import { api, dateKey, dateText, labels, type Department, type Employee, type Project, type RequestRow, type User } from "./data";
import { Field } from "./ui";

export function Editor({kind:editorKind,row,user,people,projects,departments,close,saved}: {
  kind:string; row?:RequestRow; user:User; people:Employee[]; projects:Project[]; departments:Department[];
  close:()=>void; saved:()=>void;
}) {
  const shiftDefaults = editorKind.startsWith("shift:") ? editorKind.split(":").slice(1) : [];
  const kind = shiftDefaults.length ? "shift" : editorKind;
  const [pending,setPending] = useState(false);
  const [error,setError] = useState("");
  const [draft,setDraft] = useState<FormData>();
  const employeeId = kind.startsWith("employee:") ? Number(kind.split(":")[1]) : 0;
  const [person,setPerson] = useState<Employee & {email:string;leave_days:number}>();
  useEffect(() => {
    if (!employeeId) return;
    let active = true;
    void api<Employee & {email:string;leave_days:number}>("/employees/" + employeeId + "/edit").then(data => {
      if (active) setPerson(data);
    }).catch(e => {if (active) setError(e.message);});
    return () => {active = false;};
  },[employeeId]);
  const employee = kind === "employee" || !!employeeId;
  const request = kind === "LEAVE" || kind === "SICK";
  const employeeOptions = people.map(p => <option key={p.id} value={p.id}>{p.name}</option>);
  const departmentOptions = departments.map(p => <option key={p.id} value={p.id}>{p.name}</option>);
  async function save(form: FormData) {
    const paths:Record<string,string> = {employee:"/employees",department:"/departments",shift:"/schedule",task:"/tasks",project:"/projects"};
    setPending(true);setError("");
    try {
      if (request) {
        form.set("kind",kind);
        await api(row ? "/requests/" + row.id + "/resubmit" : "/requests","POST",form);
      } else {
        const fields = Object.fromEntries(form);
        if (fields.manager_id === "") delete fields.manager_id;
        await api(employeeId ? "/employees/" + employeeId : paths[kind],employeeId ? "PATCH" : kind === "shift" ? "PUT" : "POST",fields);
      }
      saved();
    } catch (e) {setError((e as Error).message);} finally {setPending(false);}
  }
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setError("");
    if (request) {
      if (String(form.get("start")) > String(form.get("end"))) {setError("Дата окончания должна быть позже или совпадать с датой начала.");return;}
      const file = form.get("file");
      if (file instanceof File && file.size > 10 * 1024 * 1024) {setError("Размер файла превышает 10 МБ.");return;}
      setDraft(form);
    } else void save(form);
  }
  if (employeeId && !person) return <p role="status">{error || "Загрузка профиля…"}</p>;
  return <>
    <form onSubmit={submit} hidden={!!draft}>
      {request && <>
        {kind === "LEAVE" && <><p className="form-note">Остаток оплачиваемого отпуска в текущем году — <b>{user.leave_days} дн.</b></p><Field label="Тип отпуска"><select name="subtype" defaultValue={row?.subtype || "ANNUAL"}><option value="ANNUAL">{labels.ANNUAL}</option><option value="UNPAID">{labels.UNPAID}</option></select></Field></>}
        <div className="form-grid"><Field label="Дата начала"><input name="start" type="date" defaultValue={row?.start || dateKey()} required/></Field><Field label="Дата окончания"><input name="end" type="date" defaultValue={row?.end || dateKey()} required/></Field></div>
        <Field label="Комментарий"><textarea name="comment" maxLength={4000}/></Field>
        {kind === "SICK" && <div className="upload"><UploadCloud size={28}/><Field label="Медицинский документ · PDF, JPG или PNG до 10 МБ"><input name="file" type="file" accept="application/pdf,image/jpeg,image/png" required/></Field></div>}
      </>}
      {(employee || ["department","project","task"].includes(kind)) && <Field label={employee ? "Имя и фамилия" : "Название"}><input name="name" defaultValue={person?.name} maxLength={160} required/></Field>}
      {(employee || kind === "project") && <Field label="Отдел"><select name="department_id" defaultValue={person?.department_id || ""} required><option value="">Выберите отдел</option>{departmentOptions}</select></Field>}
      {employee && <><Field label="Email"><input name="email" type="email" defaultValue={person?.email} required/></Field>{!person && <Field label="Временный пароль"><input name="password" type="password" minLength={12} maxLength={128} required/></Field>}
        <div className="form-grid"><Field label="Должность"><input name="position" defaultValue={person?.position} maxLength={120} required/></Field><Field label="Роль"><select name="role" defaultValue={person?.role || "EMPLOYEE"}><option value="EMPLOYEE">Сотрудник</option><option value="MANAGER">Руководитель</option>{user.role === "DIRECTOR" && <option value="HR">HR-специалист</option>}</select></Field></div>
        <Field label="Руководитель"><select name="manager_id" defaultValue={person?.manager_id || ""}><option value="">Без руководителя</option>{people.filter(p => p.id !== employeeId && ["DIRECTOR","MANAGER"].includes(p.role)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        <Field label="Годовой лимит отпуска"><input name="leave_days" type="number" min={0} max={365} defaultValue={person?.leave_days ?? 24} required/></Field></>}
      {["project","task"].includes(kind) && <><Field label="Описание"><textarea name="description" maxLength={4000}/></Field><Field label="Срок"><input name="deadline" type="date" required/></Field></>}
      {kind === "task" && <><Field label="Проект"><select name="project_id" required><option value="">Выберите проект</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        <Field label="Исполнитель"><select name="user_id" required><option value="">Выберите исполнителя</option>{employeeOptions}</select></Field><Field label="Приоритет"><select name="priority" defaultValue="MEDIUM">{["LOW","MEDIUM","HIGH"].map(p => <option key={p} value={p}>{labels[p]}</option>)}</select></Field></>}
      {kind === "shift" && <><Field label="Сотрудник"><select name="user_id" required defaultValue={shiftDefaults[0] || ""}><option value="">Выберите сотрудника</option>{employeeOptions}</select></Field><Field label="Дата"><input name="day" type="date" required defaultValue={shiftDefaults[1] || dateKey()}/></Field><Field label="Смена"><select name="kind" defaultValue={shiftDefaults[2] || "DAY"}>{["DAY","NIGHT","OFF"].map(p => <option key={p} value={p}>{labels[p]}</option>)}</select></Field></>}
      {!draft && error && <p className="error" role="alert">{error}</p>}
      <div className="form-actions"><button type="button" onClick={close}>Отмена</button><button className="primary" disabled={pending}>{request ? "Продолжить" : "Сохранить"}</button></div>
    </form>
    {draft && <div className="review"><h3>Проверьте заявление</h3><p>{dateText(String(draft.get("start")))} — {dateText(String(draft.get("end")))}</p>
      {kind === "LEAVE" ? <p>{labels[String(draft.get("subtype"))]}</p> : <p>{(draft.get("file") as File).name}</p>}
      {draft.get("comment") && <p>{String(draft.get("comment"))}</p>}{error && <p className="error" role="alert">{error}</p>}
      <div className="form-actions"><button disabled={pending} onClick={() => setDraft(undefined)}>Назад</button><button className="primary" disabled={pending} onClick={() => save(draft)}>Отправить заявление</button></div></div>}
  </>;
}
