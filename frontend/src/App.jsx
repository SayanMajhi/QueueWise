import { useEffect, useState } from 'react';
import { ArrowRight, ChartNoAxesColumn, Clock3, History, LayoutDashboard, LogOut, Ticket, Workflow } from 'lucide-react';
import { Link, Navigate, NavLink, Outlet, Route, Routes, useLocation } from 'react-router';
import Admin from './Admin.jsx';
import Staff from './Staff.jsx';
import Student from './Student.jsx';
import { request } from './api.js';
import { Button, Feedback } from './ui.jsx';

const views = {
    STUDENT: { label: 'Student', routes: [
        { path: '/student', label: 'My queue', icon: LayoutDashboard },
        { path: '/student/history', label: 'Token history', icon: History },
    ] },
    STAFF: { label: 'Staff', routes: [{ path: '/staff', label: 'Counter workspace', icon: Workflow }] },
    ADMIN: { label: 'Administrator', routes: [{ path: '/admin', label: 'Operations', icon: ChartNoAxesColumn }] },
};
const campusDate = new Intl.DateTimeFormat('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata',
});

function Brand({ to = '/' }) {
    return <Link to={to} className="brand">
        <span className="brand-mark"><Ticket size={23} strokeWidth={2.2} aria-hidden="true" /></span>
        <span><strong>QueueWise</strong><small>Campus services</small></span>
    </Link>;
}

function Shell({ user, onLogout }) {
    const view = views[user.role];
    const [logoutError, setLogoutError] = useState(null);
    const [busy, setBusy] = useState(false);
    const { pathname } = useLocation();
    useEffect(() => {
        window.scrollTo(0, 0);
    }, [pathname]);

    async function logout() {
        setBusy(true);
        setLogoutError(null);
        try {
            await request('/auth/logout', { method: 'POST' });
            onLogout();
        } catch (error) {
            setLogoutError(error);
        } finally {
            setBusy(false);
        }
    }

    return <div className="app-shell">
        <a className="skip-link" href="#content">Skip to content</a>
        <aside className="sidebar">
            <Brand to={view.routes[0].path} />
            <div className="sidebar-main">
                <p className="nav-label">Workspace</p>
                <nav aria-label="Workspace">
                    {view.routes.map(({ path, label, icon: Icon }) => (
                        <NavLink key={path} to={path} end><Icon size={18} aria-hidden="true" />{label}</NavLink>
                    ))}
                </nav>
            </div>
            <div className="sidebar-account">
                <div className="account">
                    <span className="avatar" aria-hidden="true">{view.label[0]}</span>
                    <div><strong>{view.label}</strong><small title={user.login}>{user.login}</small></div>
                </div>
                <Button variant="quiet" className="logout-button" onClick={() => void logout()} disabled={busy}>
                    <LogOut size={17} aria-hidden="true" />{busy ? 'Signing out…' : 'Sign out'}
                </Button>
            </div>
        </aside>
        <div className="main-shell">
            <div className="topbar"><span><span className="topbar-live-dot" aria-hidden="true" />{view.label} workspace</span><span><Clock3 size={15} aria-hidden="true" />{campusDate.format(new Date())} · Campus time</span></div>
            <main id="content" className="main-content" tabIndex={-1}>
                <Feedback error={logoutError} />
                <Outlet />
            </main>
        </div>
    </div>;
}

function SignIn({ onLogin }) {
    const [waiting, setWaiting] = useState(false);
    const [error, setError] = useState(null);
    async function submit(event) {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        setWaiting(true);
        setError(null);
        try {
            onLogin(await request('/auth/login', {
                method: 'POST',
                body: { login: data.get('login'), password: data.get('password') },
            }));
        } catch (failure) {
            setError(failure);
        } finally {
            setWaiting(false);
        }
    }

    return <main className="login-shell">
        <div className="login-content">
            <section className="login-card">
                <p className="login-eyebrow">CAMPUS SERVICES</p>
                <h1>Welcome back.</h1>
                <p className="heading-description">Sign in to manage your campus queues.</p>
                <form onSubmit={(event) => void submit(event)} className="section-stack">
                    <label className="field">Login ID<input name="login" autoComplete="username" maxLength={128} required /></label>
                    <label className="field">Password<input name="password" type="password" autoComplete="current-password" required /></label>
                    <Feedback error={error} />
                    <Button type="submit" disabled={waiting}>{waiting ? 'Signing in…' : 'Sign in'}<ArrowRight size={18} aria-hidden="true" /></Button>
                </form>
            </section>
        </div>
        <div className="login-visual">
            <div className="login-visual-copy">
                <span className="login-visual-kicker">YOUR CAMPUS, IN THE LOOP</span>
                <h2>Join a campus queue<br />from anywhere.</h2>
                <p>Get a token, see your place in line, and check when it’s your turn.</p>
            </div>
        </div>
    </main>;
}

export default function App() {
    const [session, setSession] = useState({ loading: true, user: null, error: null });
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        const controller = new AbortController();
        request('/auth/me', { signal: controller.signal }).then((user) => {
            if (!controller.signal.aborted) setSession({ loading: false, user, error: null });
        }, (error) => {
            if (!controller.signal.aborted) {
                setSession({ loading: false, user: null, error: error.code === 'UNAUTHENTICATED' ? null : error });
            }
        });
        return () => controller.abort();
    }, [attempt]);
    useEffect(() => {
        function endSession() {
            setSession({ loading: false, user: null, error: null });
        }
        window.addEventListener('queuewise:session-ended', endSession);
        return () => window.removeEventListener('queuewise:session-ended', endSession);
    }, []);

    if (session.loading) return <main className="startup" role="status">Checking your session…</main>;
    if (session.error) return <main className="startup section-stack">
        <Feedback error={session.error} /><Button onClick={() => {
            setSession({ loading: true, user: null, error: null });
            setAttempt((value) => value + 1);
        }}>Try again</Button>
    </main>;

    const user = session.user;
    if (!user) return <SignIn onLogin={(account) => setSession({ loading: false, user: account, error: null })} />;

    const home = views[user.role].routes[0].path;
    return <Routes>
        <Route element={<Shell user={user} onLogout={() => setSession({ loading: false, user: null, error: null })} />}>
            {user.role === 'STUDENT' && <Route path="/student" element={<Student />} />}
            {user.role === 'STUDENT' && <Route path="/student/history" element={<Student historyOnly />} />}
            {user.role === 'STAFF' && <Route path="/staff" element={<Staff />} />}
            {user.role === 'ADMIN' && <Route path="/admin" element={<Admin />} />}
            <Route path="*" element={<Navigate to={home} replace />} />
        </Route>
    </Routes>;
}
