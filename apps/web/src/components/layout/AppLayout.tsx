import { BarChart3, Brain, LayoutDashboard, User } from "lucide-react";
import { NavLink, Outlet } from "react-router";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { to: "/", icon: LayoutDashboard, label: "Inicio" },
  { to: "/coaching", icon: Brain, label: "Coach" },
  { to: "/me", icon: User, label: "Perfil" },
];

export function AppLayout() {
  return (
    <div className="flex h-screen flex-col md:flex-row overflow-hidden">
      {/* Sidebar — solo desktop */}
      <aside className="hidden md:flex md:w-56 md:flex-col md:border-r md:border-border md:bg-card md:p-4 shrink-0">
        <div className="mb-8 px-2">
          <span className="text-xl font-bold tracking-tight bg-gradient-to-r from-violet-400 to-violet-600 bg-clip-text text-transparent">
            BodyBuilder
          </span>
        </div>
        <nav className="flex flex-col gap-1">
          {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
                )
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto px-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <BarChart3 className="h-3 w-3" />
            <span>v0.1.0</span>
          </div>
        </div>
      </aside>

      {/* Contenido principal */}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>

      {/* Bottom tab bar — solo móvil */}
      <nav className="fixed bottom-0 left-0 right-0 flex items-center justify-around border-t border-border bg-card/95 backdrop-blur-md px-8 py-2 md:hidden z-50">
        {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              cn(
                "flex flex-col items-center gap-0.5 px-6 py-1.5 rounded-xl transition-all",
                isActive ? "text-primary" : "text-muted-foreground",
              )
            }
          >
            <Icon className="h-5 w-5" />
            <span className="text-[10px] font-medium">{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
