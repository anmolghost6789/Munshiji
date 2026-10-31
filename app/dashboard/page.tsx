import { AppShell } from "@/components/app-shell";

// Applies the saved theme before first paint so dark-mode users don't see a white flash.
const themeScript = `try{var t=localStorage.getItem("munshiji-theme");document.documentElement.dataset.theme=(t==="light"||t==="dark")?t:"auto"}catch(e){document.documentElement.dataset.theme="auto"}`;

export default function Dashboard() {
  return <>
    <script dangerouslySetInnerHTML={{ __html: themeScript }} />
    <AppShell />
  </>;
}
