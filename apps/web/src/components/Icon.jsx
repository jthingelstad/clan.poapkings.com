import {
  Award,
  ChartColumn,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  FileText,
  History,
  Inbox,
  LayoutDashboard,
  Layers,
  LogOut,
  MessageSquare,
  Plane,
  Search,
  UserRound,
  Users,
} from "lucide-react";

/** The few icons this app uses, by name, the way Elixir's console names
 *  them: a rail item is a name, never an imported symbol at the call site. */
const ICONS = {
  award: Award,
  "chart-column": ChartColumn,
  check: Check,
  "chevron-down": ChevronDown,
  "chevron-up": ChevronUp,
  copy: Copy,
  "file-text": FileText,
  history: History,
  inbox: Inbox,
  "layout-dashboard": LayoutDashboard,
  layers: Layers,
  "log-out": LogOut,
  "message-square": MessageSquare,
  plane: Plane,
  search: Search,
  "user-round": UserRound,
  users: Users,
};

export function Icon({ name, size = 16 }) {
  const Glyph = ICONS[name];
  if (!Glyph) return null;
  return <Glyph size={size} strokeWidth={1.75} aria-hidden="true" />;
}
