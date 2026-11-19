"use client";

import Link from "next/link";
import { Building2 } from "lucide-react";
import { dateText, type Project, type Employee } from "./data";
import { Badge, Empty, Table } from "./ui";


export function ProjectTable({projects,people}: { projects: Project[]; people?:Employee[] }) {
  if (!projects.length) return <Empty>Проекты пока не добавлены</Empty>;
  return <Table headers={["Проект", "Прогресс", "Срок", "Статус", ...(people ? ["Задачи","Исполнители"] : [])]}>{projects.map(project =>
    <tr key={project.id}><td><Link className="project-link" href={"/projects/" + project.id}><span className="tile blue"><Building2 size={19}/></span>
      <span><b>{project.name}</b><small>{project.description}</small></span></Link></td>
      <td><strong>{project.progress}%</strong><div className="progress"><i style={{width: project.progress + "%"}} /></div></td>
      <td>{dateText(project.deadline)}</td><td><Badge value={project.status}/></td>{people && <><td>{project.task_count} · {project.overdue_count} просрочено</td><td>{project.assignee_ids.map(id=>people.find(p=>p.id===id)?.name).filter(Boolean).join(", ") || "—"}</td></>}</tr>)}</Table>;
}

