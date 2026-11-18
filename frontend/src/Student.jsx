import { useState } from 'react';
import {
    Activity, ArrowRight, Building2, Check, ClipboardCheck, Clock3,
    FileText, Headset, ListOrdered, Megaphone, Ticket, UsersRound,
} from 'lucide-react';
import { Link } from 'react-router';
import { request, useQuery } from './api.js';
import { Badge, Button, ConfirmDialog, Empty, Feedback, PageHeading, Panel } from './ui.jsx';

const activeStatuses = new Set(['WAITING', 'CALLED', 'IN_SERVICE']);
const serviceDetails = {
    ADM: { icon: ClipboardCheck, description: 'Get campus documents checked.' },
    BON: { icon: FileText, description: 'Request proof of enrollment.' },
    HOS: { icon: Building2, description: 'Get help with hostel paperwork.' },
};
const tokenStages = [
    ['WAITING', 'Waiting', Clock3],
    ['CALLED', 'Called', Megaphone],
    ['IN_SERVICE', 'In service', Headset],
    ['COMPLETED', 'Completed', Check],
];
const localTime = new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata',
});

function displayWait(seconds) {
    if (seconds === null) return 'Unavailable';
    if (seconds < 60) return '< 1 min';
    return `~${Math.ceil(seconds / 60)} min`;
}

function History({ tokens }) {
    return tokens.length === 0 ? <Empty title="No tokens yet" description="Your campus service visits will appear here." /> :
        <div className="table-wrap" role="region" tabIndex={0} aria-label="Token history">
            <table className="data-table token-history-table">
                <thead><tr><th scope="col">Token</th><th scope="col">Service</th><th scope="col">Issued (campus time)</th><th scope="col">Status</th></tr></thead>
                <tbody>{tokens.map((token) => <tr key={token.id}>
                    <th scope="row" data-label="Token">{token.tokenNumber}</th>
                    <td data-label="Service">{token.serviceName}</td>
                    <td data-label="Issued">{localTime.format(new Date(token.issuedAt))}</td>
                    <td data-label="Status"><Badge status={token.status} /></td>
                </tr>)}</tbody>
            </table>
        </div>;
}

function ActiveToken({ token, onCancel }) {
    const current = tokenStages.findIndex(([status]) => status === token.status);
    return <article className="active-ticket" tabIndex={-1} id={`ticket-${token.id}`}>
        <div className="ticket-top">
            <div><p>{token.serviceName}</p><h3>{token.tokenNumber}</h3></div>
            <div aria-live="polite"><Badge status={token.status} /></div>
        </div>
        <ol className="token-steps" aria-label="Token progress">
            {tokenStages.map(([status, label, Icon], index) => (
                <li key={status} aria-current={index === current ? 'step' : undefined}
                    className={index < current ? 'step-done' : undefined}>
                    <span><Icon size={14} aria-hidden="true" /></span>{label}
                </li>
            ))}
        </ol>
        {token.status === 'WAITING' && <>
            <dl className="ticket-metrics">
                <div><dt><UsersRound size={16} aria-hidden="true" />Queue position</dt><dd>{token.position}</dd></div>
                <div><dt><Clock3 size={16} aria-hidden="true" />Estimated wait</dt><dd>{displayWait(token.estimatedWaitSeconds)}</dd></div>
            </dl>
            <Button variant="quiet" onClick={() => onCancel(token)}>Cancel token</Button>
        </>}
        {token.status === 'CALLED' && <p className="ticket-note">It’s your turn. Please proceed to {token.counterName ?? 'the counter'}{token.counterCode ? ` (${token.counterCode})` : ''}.</p>}
        {token.status === 'IN_SERVICE' && <p className="ticket-note">The counter is currently handling your request.</p>}
    </article>;
}

export default function Student({ historyOnly = false }) {
    const tokens = useQuery('/tokens', { interval: 5_000 });
    const services = useQuery(historyOnly ? null : '/services?includeQueue=1', { interval: 12_000 });
    const [pending, setPending] = useState(null);
    const [problem, setProblem] = useState(null);
    const [message, setMessage] = useState(null);
    const [cancelToken, setCancelToken] = useState(null);
    const activeTokens = (tokens.data ?? []).filter(({ status }) => activeStatuses.has(status));

    async function join(service) {
        setPending(service.id);
        setProblem(null);
        setMessage(null);
        try {
            const ticket = await request('/tokens', { method: 'POST', body: { serviceId: service.id } });
            setMessage(`Token ${ticket.tokenNumber} is ready.`);
            await Promise.all([tokens.refresh(), services.refresh()]);
        } catch (error) {
            setProblem(error);
            await Promise.all([tokens.refresh(), services.refresh()]);
        } finally {
            setPending(null);
        }
    }

    async function cancel() {
        setPending(cancelToken.id);
        setProblem(null);
        setMessage(null);
        try {
            await request(`/tokens/${cancelToken.id}/cancel`, { method: 'POST' });
            setCancelToken(null);
            setMessage('Your token was cancelled.');
        } catch (error) {
            setCancelToken(null);
            setProblem(error);
        } finally {
            await Promise.all([tokens.refresh(), services.refresh()]);
            setPending(null);
        }
    }

    if (historyOnly) return <div className="section-stack">
        <PageHeading eyebrow="Student workspace" title="Token history" description="Review your campus service visits and their current status." />
        <Panel>
            <Feedback error={tokens.error} />
            {tokens.loading ? <p role="status">Loading token history…</p> : tokens.data && <History tokens={tokens.data} />}
        </Panel>
    </div>;

    return <div className="section-stack dashboard">
        <section className="queue-hero">
            <div className="hero-copy">
                <h1>Campus queues</h1>
                <p>Choose a service, take a token, and follow your place in line.</p>
            </div>
        </section>
        <Feedback error={problem} message={message} />
        <div className="student-grid">
            <section className="student-tokens" aria-labelledby="active-title">
                <div className="student-section-heading">
                    <span className="section-icon"><Ticket size={21} aria-hidden="true" /></span>
                    <div><h2 id="active-title">My active tokens</h2><p>Your queue status refreshes automatically.</p></div>
                </div>
                <Feedback error={tokens.error} />
                {tokens.loading && <p role="status">Loading your tokens…</p>}
                {tokens.data && activeTokens.length === 0 && <Empty title="You’re not in a queue" description="Join a campus service to track your token here." />}
                {activeTokens.map((token) => <ActiveToken key={token.id} token={token} onCancel={setCancelToken} />)}
            </section>
            <section className="student-services" aria-labelledby="services-title">
                <div className="student-section-heading">
                    <span className="section-icon"><ListOrdered size={21} aria-hidden="true" /></span>
                    <div><h2 id="services-title">Available services</h2><p>Check the queue before you join.</p></div>
                </div>
                <Feedback error={services.error} />
                {services.loading && <p role="status">Loading services…</p>}
                {services.data?.length === 0 && <Empty title="No services available" description="Check again when campus offices reopen." />}
                {services.data?.length > 0 && <ul className="service-list">{services.data.map((service) => {
                    const details = serviceDetails[service.code];
                    const Icon = details?.icon ?? Building2;
                    const joined = activeTokens.find(({ serviceId }) => serviceId === service.id);
                    return <li key={service.id} className="service-row">
                        <div className="service-heading">
                            <span className="service-icon"><Icon size={22} aria-hidden="true" /></span>
                            <div className="service-name"><h3>{service.name}</h3>{details && <p>{details.description}</p>}</div>
                        </div>
                        <div className="service-footer">
                            <div className="service-activity">
                                <span><UsersRound size={15} aria-hidden="true" />{service.waiting} waiting</span>
                                <span><Activity size={15} aria-hidden="true" />{service.openCounters
                                    ? `${service.openCounters} ${service.openCounters === 1 ? 'counter' : 'counters'} open`
                                    : 'No open counters'}</span>
                            </div>
                            {joined ? <a className="text-link" href={`#ticket-${joined.id}`}>View token <ArrowRight size={15} aria-hidden="true" /></a> : <Button
                                variant="secondary" disabled={pending !== null}
                                aria-label={`Join queue for ${service.name}`}
                                onClick={() => void join(service)}
                            >{pending === service.id ? 'Joining…' : 'Join queue'}<ArrowRight size={15} aria-hidden="true" /></Button>}
                        </div>
                    </li>;
                })}</ul>}
            </section>
        </div>
        <Panel title="Recent tokens" actions={<Link className="text-link" to="/student/history">View history <ArrowRight size={16} aria-hidden="true" /></Link>}>
            {tokens.loading && <p role="status">Loading recent tokens…</p>}
            {tokens.data && <History tokens={tokens.data.slice(0, 4)} />}
        </Panel>
        {cancelToken && <ConfirmDialog
            title="Cancel this token?" description={`Cancelling ${cancelToken.tokenNumber} releases your place in the queue.`}
            confirmLabel="Cancel token" onConfirm={() => void cancel()} onClose={() => setCancelToken(null)}
            busy={pending === cancelToken.id}
        />}
    </div>;
}
