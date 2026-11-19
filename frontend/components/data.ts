export type Role = "DIRECTOR" | "HR" | "MANAGER" | "EMPLOYEE";
export type Employee = { id: number; name: string; role: Role; department_id: number; manager_id: number | null; position: string; working_status?: string };
export type User = Employee & { email: string; phone: string; leave_days: number; company: string; demo: boolean; manager: string | null };
export type Department = { id: number; name: string };
export type Project = { id: number; name: string; description: string; deadline: string; progress: number; status: string; department_id: number; task_count: number; overdue_count: number; assignee_ids: number[] };
export type Task = { id: number; name: string; description: string; deadline: string; status: string; priority: string; user_id: number; project_id: number };
export type RequestRow = { id: number; user_id: number; kind: "LEAVE" | "SICK"; subtype: string; start: string; end: string; status: string };
export type Shift = { id: number; user_id: number; day: string; kind: string };
export type Schedule = { shifts: Shift[]; absences: { id: number; user_id: number; start: string; end: string; kind?: string }[] };
export type Note = { id: number; message: string; read: boolean; created_at: string };
export type Event = { id: number; action: string; detail: Record<string, string>; created_at: string };
export type Overview = {
  today: string; today_shift: Shift | null; due_today: Task[];
  department_stats?: {id:number; name:string; people:number; planned:number; done:number}[];
  staff_status?: Record<string,number>; absences?: Schedule["absences"]; team_shifts?: Shift[];
  workload?: {id:number; name:string; active:number; status:string}[];
  activity?: {id:number; label:string; action:string; created_at:string}[];
  counts: Record<string, number>; trend: { day: string; planned: number; done: number }[];
  projects: Project[]; project_status: Record<string, number>; overdue: Task[]; tasks: Task[];
  upcoming: Task[]; next_shift: Shift | null; working_status: string;
};
export const labels: Record<string, string> = {
  DIRECTOR:"Директор", HR:"HR-специалист", MANAGER:"Руководитель", EMPLOYEE:"Сотрудник",
  TODO:"К выполнению", IN_PROGRESS:"В работе", IN_REVIEW:"На проверке", COMPLETED:"Выполнено", CANCELLED:"Отменено",
  LOW:"Низкий", MEDIUM:"Средний", HIGH:"Высокий", APPROVED:"Одобрено", PENDING:"На согласовании",
  REJECTED:"Отклонено", RETURNED:"На исправлении", LEAVE:"Отпуск", SICK:"Больничный", ANNUAL:"Ежегодный оплачиваемый",
  UNPAID:"Без сохранения зарплаты", DAY:"Дневная", NIGHT:"Ночная", OFF:"Выходной", ABSENT:"Отсутствует",
  WORKING:"На работе", ON_TRACK:"В срок", RISK:"Есть риск", LATE:"Отставание", DONE:"Завершён",
  CREATED:"Создано", UPDATED:"Обновлено", RESUBMITTED:"Отправлено повторно", STATUS:"Статус изменён", COMMENT:"Комментарий",
};
export const statuses = ["TODO","IN_PROGRESS","IN_REVIEW","COMPLETED","CANCELLED"];
export function dateKey(date = new Date()) { return new Intl.DateTimeFormat("sv-SE", {timeZone:"Asia/Almaty"}).format(date); }
export function offset(day: string, count: number) {
  const date = new Date(day + "T12:00:00Z");
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0,10);
}
export function dateText(day: string) {
  return new Intl.DateTimeFormat("ru-RU", {day:"numeric", month:"short", timeZone:"UTC"}).format(new Date(day.slice(0,10) + "T12:00:00Z"));
}
export async function api<T>(path: string, method = "GET", data?: object) {
  const form = data instanceof FormData;
  const response = await fetch("/api" + path, {
    method, cache:"no-store", headers: data && !form ? {"Content-Type":"application/json"} : undefined,
    body: form ? data : data ? JSON.stringify(data) : undefined,
  });
  if (response.status === 401 && path !== "/auth/login" && path !== "/me") window.dispatchEvent(new Event("session-expired"));
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof result?.detail === "string" ? result.detail : response.status === 422 ?
    "Проверьте заполнение полей." : "Не удалось выполнить запрос. Попробуйте ещё раз.");
  return result as T;
}
