import { expect, test, type Page } from "@playwright/test";

import { dateKey, offset } from "../components/data";

const password = process.env.DEMO_PASSWORD;
test.skip(!password, "Set DEMO_PASSWORD and start the seeded workspace");

async function signIn(page: Page, role: string) {
  await page.goto("/");
  await page.getByLabel("Email").fill(role + "@demo.example");
  await page.getByLabel("Пароль", {exact:true}).fill(password!);
  await page.getByRole("button",{name:"Войти",exact:true}).click();
  await expect(page.getByRole("heading",{name:/Добро пожаловать/})).toBeVisible();
}

for (const [role,title,widget,menuItem] of [["director","Панель директора","Выполнение по отделам","Оргструктура"],["hr","Панель HR","Очередь согласования","Отпуска и отсутствия"],["manager","Панель руководителя","Нагрузка команды","График команды"],["employee","Личный кабинет","Мои задачи на сегодня","Мой график"]]) {
  test(role + " opens the role dashboard", async ({page}) => {
    await signIn(page,role);
    await expect(page.locator("main").getByText(title,{exact:true})).toBeVisible();
    await page.getByRole("button",{name:"Сменить тему"}).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme","light");
    await page.reload();
    await expect(page.locator("main").getByText(title,{exact:true})).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme","light");
    await expect(page.getByRole("heading",{name:widget,exact:true})).toBeVisible();
    const nav = page.getByRole("navigation",{name:"Разделы"});
    if (!(await nav.isVisible())) await page.getByRole("button",{name:"Меню",exact:true}).click();
    await expect(nav.getByRole("link",{name:menuItem,exact:true})).toBeVisible();
    if (role==="employee") await expect(nav.getByRole("link",{name:"Сотрудники",exact:true})).toHaveCount(0);
    if (role==="hr") await expect(page.getByRole("heading",{name:"Статусы проектов",exact:true})).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test("dashboard filtering, drill-down and responsive widths", async ({page},info) => {
  test.skip(info.project.name === "mobile", "Desktop viewport is resized to all required sizes");
  await signIn(page,"director");
  const department = page.getByRole("combobox",{name:"Отдел",exact:true});
  await expect.poll(() => department.locator("option").count()).toBeGreaterThan(1);
  const value = await department.locator("option").nth(1).getAttribute("value");
  await department.selectOption(value!);
  const section = page.locator("main");
  const drill = section.getByRole("link",{name:/Выполнение плана/});
  await expect(drill).toHaveAttribute("href",new RegExp("department="+value));
  for (const [width,height] of [[1920,1080],[1440,900],[1366,768],[768,1024],[390,844]]) {
    await page.setViewportSize({width,height});
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await drill.click();
  await expect(page.getByRole("combobox",{name:"Отдел",exact:true})).toHaveValue(value!);
  await expect(page.getByRole("button",{name:"Сбросить период"})).toBeVisible();
});

test("employee submits leave and HR approves it", async ({page, browser}, info) => {
  await signIn(page,"employee");
  await page.getByRole("button",{name:"Подать заявление на отпуск"}).click();
  const start = info.project.name === "desktop" ? 40 : 150;
  const tracked = await page.request.get("/api/requests");
  const intervals: {start:string; end:string; status:string}[] = await tracked.json();
  const days = Array.from({length:90},(_,i) => offset(dateKey(),start + i));
  const day = days.find(date => !intervals.some(r => ["PENDING","APPROVED"].includes(r.status) && r.start <= date && date <= r.end));
  expect(day).toBeDefined();
  await page.getByLabel("Тип отпуска").selectOption("UNPAID");
  await page.getByLabel("Дата начала").fill(day!);
  await page.getByLabel("Дата окончания").fill(day!);
  await page.getByLabel("Комментарий").fill("Демонстрационная заявка Playwright");
  await page.getByRole("button",{name:"Продолжить",exact:true}).click();
  const submitted = page.waitForResponse(response => response.url().endsWith("/api/requests") && response.request().method() === "POST");
  await page.getByRole("button",{name:"Отправить заявление",exact:true}).click();
  const response = await submitted;
  expect(response.status()).toBe(201);
  const {id} = await response.json();
  const hr = await browser.newPage({baseURL:info.project.use.baseURL});
  await signIn(hr,"hr");
  await hr.goto("/requests/" + id);
  await hr.getByRole("button",{name:"Сохранить решение"}).click();
  await expect(hr.getByText("Одобрено",{exact:true}).first()).toBeVisible();
  await hr.close();
  await page.goto("/requests/" + id);
  await expect(page.getByText("Одобрено",{exact:true}).first()).toBeVisible();
});

test("employee uploads a PDF which only the owner and HR can download", async ({page,browser}, info) => {
  await signIn(page,"employee");
  await page.getByRole("button",{name:"Загрузить больничный"}).click();
  const tracked = await page.request.get("/api/requests");
  const intervals: {start:string; end:string; status:string}[] = await tracked.json();
  const start = info.project.name === "desktop" ? 245 : 300;
  const days = Array.from({length:45},(_,i) => offset(dateKey(),start + i));
  const day = days.find(date => !intervals.some(r => ["PENDING","APPROVED"].includes(r.status) && r.start <= date && date <= r.end));
  expect(day).toBeDefined();
  await page.getByLabel("Дата начала").fill(day!);
  await page.getByLabel("Дата окончания").fill(day!);
  await page.getByLabel(/Медицинский документ/).setInputFiles({
    name:"qa-document.pdf",mimeType:"application/pdf",buffer:Buffer.from("%PDF-1.7\n%%EOF\n"),
  });
  await page.getByRole("button",{name:"Продолжить",exact:true}).click();
  const submitted = page.waitForResponse(response => response.url().endsWith("/api/requests") && response.request().method() === "POST");
  await page.getByRole("button",{name:"Отправить заявление",exact:true}).click();
  const result = await submitted;
  expect(result.status()).toBe(201);
  const {id} = await result.json();
  const path = "/api/requests/" + id + "/document";
  expect((await page.request.get(path)).status()).toBe(200);
  for (const [role,status] of [["manager",404],["director",404],["hr",200]] as const) {
    const viewer = await browser.newPage({baseURL:info.project.use.baseURL});
    await signIn(viewer,role);
    expect((await viewer.request.get(path)).status()).toBe(status);
    await viewer.close();
  }
});
