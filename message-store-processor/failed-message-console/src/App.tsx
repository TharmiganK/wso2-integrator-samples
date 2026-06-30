import { Navigate, NavLink, Route, Routes, useNavigate } from "react-router-dom";
import { useAuth } from "./auth";
import Login from "./views/Login";
import WorkflowsView from "./views/WorkflowsView";
import WorkflowDetailView from "./views/WorkflowDetailView";
import TasksView from "./views/TasksView";
import FailedActivitiesView from "./views/FailedActivitiesView";
import FailedActivityDetailView from "./views/FailedActivityDetailView";
import TaskDetailView from "./views/TaskDetailView";

function Shell() {
  const { session, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate("/login");
  }

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">📦 Failed Sales Order Console</span>
        <div className="user">
          <span>
            {session?.userId} · <span className="muted">{session?.roles.join(", ")}</span>
          </span>
          <button className="btn small" onClick={handleLogout}>
            Sign out
          </button>
        </div>
      </header>
      <nav className="nav">
        <NavLink to="/workflows" className={({ isActive }) => (isActive ? "active" : "")}>
          Failed Orders
        </NavLink>
        <NavLink to="/tasks" className={({ isActive }) => (isActive ? "active" : "")}>
          Review Tasks
        </NavLink>
        <NavLink to="/failed-activities" className={({ isActive }) => (isActive ? "active" : "")}>
          Failed Replays
        </NavLink>
      </nav>
      <main className="content">
        <Routes>
          <Route path="/workflows" element={<WorkflowsView />} />
          <Route path="/workflows/:workflowId" element={<WorkflowDetailView />} />
          <Route path="/tasks" element={<TasksView />} />
          <Route path="/tasks/:taskId" element={<TaskDetailView />} />
          <Route path="/failed-activities" element={<FailedActivitiesView />} />
          <Route path="/failed-activities/:taskId" element={<FailedActivityDetailView />} />
          <Route path="*" element={<Navigate to="/workflows" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  const { session } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={session ? <Navigate to="/workflows" replace /> : <Login />} />
      <Route path="/*" element={session ? <Shell /> : <Navigate to="/login" replace />} />
    </Routes>
  );
}
