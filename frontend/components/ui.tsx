"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Inbox, LoaderCircle, X } from "lucide-react";
import { labels } from "./data";

export function Badge({ value }: { value: string }) {
  return <span className={"badge badge-" + value.toLowerCase()}>{labels[value] || value}</span>;
}
export function Avatar({ name }: { name: string }) {
  return <span className="avatar" aria-hidden>{name.split(" ").slice(0,2).map(part => part[0]).join("")}</span>;
}
export function Empty({ children = "Здесь пока нет записей" }: { children?: ReactNode }) {
  return <div className="empty"><Inbox size={24} />{children}</div>;
}
export function Loading() {
  return <div className="empty" role="status"><LoaderCircle className="spin" size={23} />Загрузка…</div>;
}
export function Panel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return <section className="panel"><div className="panel-head"><h2>{title}</h2>{action}</div>{children}</section>;
}
export function Table({ headers, children }: { headers: string[]; children: ReactNode }) {
  return <div className="table-scroll"><table><thead><tr>{headers.map(title => <th key={title} scope="col">{title}</th>)}</tr></thead><tbody>{children}</tbody></table></div>;
}
export function Dialog({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  return <dialog ref={ref} onCancel={event => { event.preventDefault(); close(); }}>
    <div className="panel-head"><h2>{title}</h2><button className="icon" type="button" aria-label="Закрыть" onClick={close}><X size={19}/></button></div>{children}
  </dialog>;
}
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}
export function Stat({ title, value, icon, detail, color = "blue" }: {title:string; value: ReactNode; icon:ReactNode; detail?:string; color?:string}) {
  return <article className="stat"><span className={"tile " + color}>{icon}</span><div><p>{title}</p><strong>{value}</strong>{detail && <small>{detail}</small>}</div></article>;
}
