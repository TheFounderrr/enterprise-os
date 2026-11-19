import type { Metadata } from "next";
import "./style.css";
import "./professional.css";

export const metadata: Metadata = { title: "Enterprise OS v0.2 Professional Edition", description: "Управление компанией" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru" suppressHydrationWarning><body>{children}</body></html>;
}
