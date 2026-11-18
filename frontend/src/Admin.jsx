import { useState } from 'react';
import {
    Activity, Bell, CircleCheck, Clock, DoorOpen,
    Layers, Plus, RefreshCw, Ticket, UsersRound,
} from 'lucide-react';
import { request, useQuery } from './api.js';
import { Badge, Button, ConfirmDialog, Empty, Feedback, PageHeading, Panel } from './ui.jsx';
import './admin.css';

const metricGroups = [
    { id: 'live', title: 'Live queue', items: [
        ['waiting', 'Waiting', Clock],
        ['called', 'Called', Bell],
        ['inService', 'In service', Activity],
        ['openCounters', 'Open counters', DoorOpen],
    ] },
    { id: 'today', title: 'Campus day', items: [
        ['issuedToday', 'Issued today', Ticket],
        ['completedToday', 'Completed today', CircleCheck],
    ] },
];
const adminSections = [
    ['services', 'Services', Layers],
    ['counters', 'Counters', DoorOpen],
    ['staff', 'Staff assignments', UsersRound],
];
const numberFormat = new Intl.NumberFormat();

function QueueSummary({ summary }) {
    return (
        <div className="admin-summary">
            {metricGroups.map(({ id, title, items }) => (
                <section className="admin-summary-group" key={id} aria-labelledby={`admin-${id}-title`}>
                    <h2 id={`admin-${id}-title`}>{title}</h2>
                    <dl className="admin-metrics" style={{ '--admin-tile-count': items.length }}>
                        {items.map(([key, label, Icon]) => (
                            <div className={`admin-tile admin-tile-${key}`} key={key}>
                                <dt><span className="admin-tile-icon"><Icon size={19} aria-hidden="true" /></span>{label}</dt>
                                <dd>{numberFormat.format(summary[key])}</dd>
                            </div>
                        ))}
                    </dl>
                </section>
            ))}
        </div>
    );
}

function FormActions({ label, busy, onCancel }) {
    return (
        <div className="actions">
            <Button type="submit" disabled={busy}>{busy ? 'Saving…' : label}</Button>
            <Button type="button" variant="quiet" disabled={busy} onClick={onCancel}>Cancel</Button>
        </div>
    );
}

function ServicePanel({ services, busy, notice, save, confirm }) {
    const [editor, setEditor] = useState(null);
    const scope = 'services';

    async function submit(event) {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);
        const body = {
            name: fields.get('name').trim(),
            defaultServiceSeconds: Number(fields.get('duration')),
        };
        if (!editor.id) body.code = fields.get('code').trim().toUpperCase();
        if (await save({
            scope,
            path: editor.id ? `/services/${editor.id}` : '/services',
            method: editor.id ? 'PATCH' : 'POST',
            body,
            message: editor.id ? 'Service settings saved.' : 'Service added.',
        })) setEditor(null);
    }

    function changeIntake(service) {
        const change = {
            scope,
            path: `/services/${service.id}`,
            method: 'PATCH',
            body: { acceptsTokens: !service.acceptsTokens },
            message: service.acceptsTokens ? 'Token intake paused.' : 'Token intake resumed.',
        };
        if (service.acceptsTokens) {
            confirm({
                ...change,
                title: `Pause intake for ${service.name}?`,
                description: 'Students will be unable to take new tokens. Staff can continue serving the existing queue.',
                label: 'Pause intake',
            });
        } else {
            void save(change);
        }
    }

    return (
        <Panel title="Services" description="View live queue activity and manage token intake."
            actions={<Button variant="secondary" disabled={busy || Boolean(editor)} onClick={() => setEditor({})}><Plus size={16} aria-hidden="true" /> Add service</Button>}>
            {notice?.scope === scope && <Feedback error={notice.error} message={notice.message} />}
            {editor && (
                <form key={editor.id ?? 'new'} className="section-stack admin-editor" onSubmit={submit}>
                    <h3 className="font-semibold">{editor.id ? `Edit ${editor.name}` : 'New service'}</h3>
                    <div className="form-grid">
                        {!editor.id && <label className="field">Service code<input name="code" maxLength={32} required placeholder="ADM" autoFocus /></label>}
                        <label className="field">Service name<input name="name" maxLength={120} required defaultValue={editor.name ?? ''} autoFocus={Boolean(editor.id)} /></label>
                        <label className="field">Default service time (seconds)<input name="duration" type="number" min="1" max="2147483647" step="1" required defaultValue={editor.defaultServiceSeconds ?? 300} /></label>
                    </div>
                    <FormActions label={editor.id ? 'Save service' : 'Create service'} busy={busy} onCancel={() => setEditor(null)} />
                </form>
            )}
            {services.length === 0 ? (
                <Empty title="No services yet" description="Add a service to start offering campus queue tokens." />
            ) : (
                <div className="table-wrap admin-table-wrap" role="region" aria-label="Campus services" tabIndex={0}>
                    <table className="data-table admin-table admin-services-table">
                        <thead><tr><th scope="col">Service</th><th scope="col">Intake</th><th scope="col">Waiting</th><th scope="col">Called</th><th scope="col">In service</th><th scope="col">Open counters</th><th scope="col">Actions</th></tr></thead>
                        <tbody>{services.map((service) => (
                            <tr key={service.id}>
                                <th scope="row"><span className="admin-row-title">{service.name}</span><span className="admin-row-meta">{service.code} · {service.defaultServiceSeconds}s default</span></th>
                                <td><Badge status={service.acceptsTokens ? 'OPEN' : 'CLOSED'}>{service.acceptsTokens ? 'Accepting' : 'Paused'}</Badge></td>
                                <td>{numberFormat.format(service.waiting)}</td><td>{numberFormat.format(service.called)}</td>
                                <td>{numberFormat.format(service.inService)}</td><td>{numberFormat.format(service.openCounters)}</td>
                                <td><div className="actions">
                                    <Button variant="quiet" disabled={busy || Boolean(editor)} aria-label={`Edit ${service.name}`} onClick={() => setEditor(service)}>Edit</Button>
                                    <Button variant="quiet" disabled={busy} aria-label={`${service.acceptsTokens ? 'Pause' : 'Resume'} intake for ${service.name}`} onClick={() => changeIntake(service)}>{service.acceptsTokens ? 'Pause' : 'Resume'}</Button>
                                </div></td>
                            </tr>
                        ))}</tbody>
                    </table>
                </div>
            )}
        </Panel>
    );
}

function CounterPanel({ counters, services, serviceNames, busy, notice, save }) {
    const [editor, setEditor] = useState(null);
    const scope = 'counters';

    async function submit(event) {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);
        const body = { name: fields.get('name').trim() };
        if (!editor.id) {
            body.serviceId = fields.get('serviceId');
            body.code = fields.get('code').trim().toUpperCase();
        }
        if (await save({
            scope,
            path: editor.id ? `/counters/${editor.id}` : '/counters',
            method: editor.id ? 'PATCH' : 'POST',
            body,
            message: editor.id ? 'Counter saved.' : 'Counter added.',
        })) setEditor(null);
    }

    return (
        <Panel title="Counters" description="Manage each service’s desks and see which are taking tokens."
            actions={<Button variant="secondary" disabled={busy || Boolean(editor) || services.length === 0} onClick={() => setEditor({})}><Plus size={16} aria-hidden="true" /> Add counter</Button>}>
            {notice?.scope === scope && <Feedback error={notice.error} message={notice.message} />}
            {editor && (
                <form key={editor.id ?? 'new'} className="section-stack admin-editor" onSubmit={submit}>
                    <h3 className="font-semibold">{editor.id ? `Edit ${editor.name}` : 'New counter'}</h3>
                    <div className="form-grid">
                        {!editor.id && <>
                            <div className="field"><label htmlFor="counter-service">Service</label><select id="counter-service" name="serviceId" defaultValue="" required autoFocus><option value="" disabled>Select a service</option>{services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select></div>
                            <label className="field">Counter code<input name="code" maxLength={32} required /></label>
                        </>}
                        <label className="field">Counter name<input name="name" maxLength={120} required defaultValue={editor.name ?? ''} autoFocus={Boolean(editor.id)} /></label>
                    </div>
                    <FormActions label={editor.id ? 'Save counter' : 'Create counter'} busy={busy} onCancel={() => setEditor(null)} />
                </form>
            )}
            {counters.length === 0 ? (
                <Empty title="No counters yet" description={services.length ? 'Add a counter to a service.' : 'Create a service before adding counters.'} />
            ) : (
                <div className="table-wrap admin-table-wrap" role="region" aria-label="Service counters" tabIndex={0}>
                    <table className="data-table admin-table">
                        <thead><tr><th scope="col">Counter</th><th scope="col">Service</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead>
                        <tbody>{counters.map((counter) => (
                            <tr key={counter.id}>
                                <th scope="row"><span className="admin-row-title">{counter.name}</span><span className="admin-row-meta">{counter.code}</span></th>
                                <td>{serviceNames.get(counter.serviceId)}</td>
                                <td><Badge status={counter.status} /></td>
                                <td><Button variant="quiet" disabled={busy || Boolean(editor)} aria-label={`Edit ${counter.name}`} onClick={() => setEditor(counter)}>Edit</Button></td>
                            </tr>
                        ))}</tbody>
                    </table>
                </div>
            )}
        </Panel>
    );
}

function AssignmentPanel({ staff, counters, serviceNames, busy, notice, save, confirm }) {
    const [editor, setEditor] = useState(null);
    const scope = 'staff';
    const counterNames = new Map(counters.map((counter) => [counter.id, `${serviceNames.get(counter.serviceId)} · ${counter.name}`]));

    async function submit(event) {
        event.preventDefault();
        const counterId = new FormData(event.currentTarget).get('counterId');
        if (await save({
            scope,
            path: `/counters/${counterId}/staff/${editor.id}`,
            method: 'PUT',
            message: 'Staff assignment saved.',
        })) setEditor(null);
    }

    return (
        <Panel title="Staff assignments" description="Choose which counter each staff member can operate.">
            {notice?.scope === scope && <Feedback error={notice.error} message={notice.message} />}
            {editor && (
                <form className="section-stack admin-editor" onSubmit={submit}>
                    <h3 className="font-semibold">Assign {editor.login}</h3>
                    <div className="form-grid">
                        <div className="field"><label htmlFor="staff-assignment-counter">Counter</label><select id="staff-assignment-counter" name="counterId" defaultValue={editor.counterId ?? ''} required autoFocus><option value="" disabled>Select a counter</option>{counters.map((counter) => <option key={counter.id} value={counter.id}>{counterNames.get(counter.id)}</option>)}</select></div>
                    </div>
                    <FormActions label="Save assignment" busy={busy} onCancel={() => setEditor(null)} />
                </form>
            )}
            {staff.length === 0 ? (
                <Empty title="No staff available" description="Staff accounts appear here when active." />
            ) : (
                <div className="table-wrap admin-table-wrap" role="region" aria-label="Staff assignments" tabIndex={0}>
                    <table className="data-table admin-table">
                        <thead><tr><th scope="col">Staff login</th><th scope="col">Assigned counter</th><th scope="col">Actions</th></tr></thead>
                        <tbody>{staff.map((person) => (
                            <tr key={person.id}>
                                <th scope="row" className="admin-row-title">{person.login}</th>
                                <td>{counterNames.get(person.counterId) ?? 'Unassigned'}</td>
                                <td><div className="actions">
                                    <Button variant="quiet" disabled={busy || Boolean(editor) || counters.length === 0} aria-label={`${person.counterId ? 'Change' : 'Assign'} counter for ${person.login}`} onClick={() => setEditor(person)}>{person.counterId ? 'Change counter' : 'Assign'}</Button>
                                    {person.counterId && <Button variant="quiet" disabled={busy || Boolean(editor)} aria-label={`Unassign ${person.login}`} onClick={() => confirm({
                                        scope,
                                        path: `/counters/${person.counterId}/staff/${person.id}`,
                                        method: 'DELETE',
                                        message: 'Staff assignment removed.',
                                        title: `Unassign ${person.login}?`,
                                        description: 'This staff member will lose access to the counter until assigned again.',
                                        label: 'Unassign',
                                    })}>Unassign</Button>}
                                </div></td>
                            </tr>
                        ))}</tbody>
                    </table>
                </div>
            )}
        </Panel>
    );
}

export default function Admin() {
    const overview = useQuery('/admin/overview', { interval: 10000 });
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState(null);
    const [confirmation, setConfirmation] = useState(null);

    async function save({ scope, path, method, body, message }) {
        setBusy(true);
        setNotice(null);
        try {
            await request(path, { method, body });
            await overview.refresh();
            setNotice({ scope, message });
            return true;
        } catch (error) {
            setNotice({ scope, error });
            return false;
        } finally {
            setBusy(false);
        }
    }

    const { data, error, loading, refresh } = overview;
    const serviceNames = new Map(data?.services.map((service) => [service.id, service.name]));
    const managementProps = { busy, notice: confirmation ? null : notice, save, confirm: setConfirmation };

    return (
        <div className="section-stack admin-dashboard">
            <PageHeading eyebrow="Administration" title="Operations overview" description="Monitor campus queues and manage services, counters, and staff access.">
                <Button variant="secondary" disabled={loading || busy} onClick={refresh}><RefreshCw size={16} aria-hidden="true" /> Refresh</Button>
            </PageHeading>
            {error && <Feedback error={error} />}
            {loading && !data && <p role="status" className="muted">Loading operations overview…</p>}
            {data && <>
                <QueueSummary summary={data.summary} />
                <nav className="admin-jump-nav" aria-label="Operations sections">
                    {adminSections.map(([id, label, Icon]) => (
                        <a href={`#admin-${id}`} key={id}>
                            <Icon size={17} aria-hidden="true" />{label}
                        </a>
                    ))}
                </nav>
                <div className="admin-anchor" id="admin-services" tabIndex={-1}>
                    <ServicePanel services={data.services} {...managementProps} />
                </div>
                <div className="admin-management-grid">
                    <div className="admin-anchor" id="admin-counters" tabIndex={-1}>
                        <CounterPanel counters={data.counters} services={data.services} serviceNames={serviceNames} {...managementProps} />
                    </div>
                    <div className="admin-anchor" id="admin-staff" tabIndex={-1}>
                        <AssignmentPanel staff={data.staff} counters={data.counters} serviceNames={serviceNames} {...managementProps} />
                    </div>
                </div>
            </>}
            {confirmation && <ConfirmDialog title={confirmation.title} description={confirmation.description}
                confirmLabel={confirmation.label} busy={busy} onClose={() => { setConfirmation(null); setNotice(null); }}
                onConfirm={async () => { if (await save(confirmation)) setConfirmation(null); }}>
                {notice?.scope === confirmation.scope && <Feedback error={notice.error} />}
            </ConfirmDialog>}
        </div>
    );
}
