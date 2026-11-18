import { useRef, useState } from 'react';
import { ArrowRight, BellRing, Check, Monitor, Play, Power, SkipForward, Ticket, UserX, UsersRound } from 'lucide-react';

import { request, useQuery } from './api.js';
import { Badge, Button, ConfirmDialog, Empty, Feedback, PageHeading, Panel } from './ui.jsx';
import './staff.css';

const campusClock = new Intl.DateTimeFormat('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
});

function CounterWorkspace({ assignedCounter, refreshAssignment, assignmentUnavailable }) {
    const queuePath = `/counters/${assignedCounter.id}/queue`;
    const queue = useQuery(queuePath, { interval: 4_000 });
    const [pendingAction, setPendingAction] = useState(null);
    const [feedback, setFeedback] = useState({});
    const [dialog, setDialog] = useState(null);
    const [reason, setReason] = useState('');
    const [reasonError, setReasonError] = useState('');
    const requestInFlight = useRef(false);

    const counter = queue.data?.counter ?? assignedCounter;
    const current = queue.data?.currentToken;
    const waiting = queue.data?.waiting ?? [];
    const canManage = Boolean(queue.data) && !queue.error && !assignmentUnavailable;
    const activeDialog = canManage && dialog && (
        dialog.action === 'close'
            ? counter.status === 'OPEN'
            : current?.id === dialog.tokenId && current.status === 'CALLED'
    ) ? dialog : null;

    function showDialog(action) {
        setReason('');
        setReasonError('');
        setDialog({ action, tokenId: current?.id });
    }

    async function run(action, tokenId, body) {
        if (!canManage || requestInFlight.current) return;
        requestInFlight.current = true;
        setPendingAction(action);
        setFeedback({});

        const path = tokenId
            ? `/tokens/${tokenId}/${action}`
            : `/counters/${counter.id}/${action}`;
        try {
            const result = await request(path, { method: 'POST', body });
            const messages = {
                open: 'Counter opened.',
                close: result?.status === 'DRAINING' ? 'The counter will close after the current token.' : 'Counter closed.',
                'call-next': result ? `Called ${result.tokenNumber}.` : 'There are no students waiting.',
                start: `Started service for ${result?.tokenNumber}.`,
                complete: `Completed ${result?.tokenNumber}.`,
                skip: `Skipped ${result?.tokenNumber}.`,
                'no-show': `Marked ${result?.tokenNumber} as a no-show.`,
            };
            setFeedback({ message: messages[action] });
        } catch (error) {
            setFeedback({ error });
        } finally {
            setDialog(null);
            await Promise.all([queue.refresh(), refreshAssignment()]);
            requestInFlight.current = false;
            setPendingAction(null);
        }
    }

    function confirmAction() {
        if (!activeDialog) return;
        if (activeDialog.action === 'skip' && !reason.trim()) {
            setReasonError('Enter a reason to skip this token.');
            return;
        }

        const body = activeDialog.action === 'skip' ? { reason: reason.trim() } : undefined;
        const tokenId = activeDialog.action === 'close' ? undefined : activeDialog.tokenId;
        void run(activeDialog.action, tokenId, body);
    }

    const dialogCopy = {
        close: {
            title: 'Close this counter?',
            description: current
                ? 'This counter will stop calling tokens and close when you resolve the current one.'
                : 'Open the counter again when you’re ready to call another token.',
            label: 'Close counter',
        },
        skip: {
            title: 'Skip this token?',
            description: `${current?.tokenNumber} will leave the queue. Record why it was skipped.`,
            label: 'Skip token',
        },
        'no-show': {
            title: 'Mark as no-show?',
            description: `${current?.tokenNumber} will leave the queue as a no-show.`,
            label: 'Mark no-show',
        },
    };
    const blocked = !canManage || Boolean(pendingAction);

    return (
        <div className="section-stack">
            <Panel className="staff-counter">
                <div className="staff-counter-identity">
                    <div className="staff-counter-icon"><Monitor aria-hidden="true" size={22} /></div>
                    <div>
                        <h2>{counter.name}</h2>
                        <p className="staff-counter-code">Counter {counter.code}</p>
                    </div>
                </div>
                <div className="actions">
                    <Badge status={counter.status} />
                    {counter.status === 'OPEN' && (
                        <Button variant="secondary" disabled={blocked} onClick={() => showDialog('close')}>
                            <Power aria-hidden="true" size={16} /> Close counter
                        </Button>
                    )}
                </div>
            </Panel>

            {feedback.error && <Feedback error={feedback.error} />}
            {feedback.message && <Feedback message={feedback.message} />}
            {queue.error && (
                <div className="actions">
                    <Feedback error={queue.error} />
                    <Button variant="secondary" onClick={queue.refresh}>Retry queue</Button>
                </div>
            )}
            {queue.loading && !queue.data && <Feedback message="Loading the counter queue…" />}

            {queue.data && (
                <div className="staff-grid">
                    <Panel title="Current token" className="staff-current">
                        {counter.status === 'DRAINING' && (
                            <p className="staff-draining">This counter will close after you resolve the current token.</p>
                        )}
                        {current ? (
                            <>
                                <div className="staff-focus">
                                    <p className="staff-focus-label"><Ticket aria-hidden="true" size={17} />{current.serviceName}</p>
                                    <p className="staff-token-number">{current.tokenNumber}</p>
                                    <ol className="staff-progress" role="list" aria-label="Service progress">
                                        <li aria-current={current.status === 'CALLED' ? 'step' : undefined}>
                                            {current.status === 'CALLED'
                                                ? <BellRing aria-hidden="true" size={15} />
                                                : <Check aria-hidden="true" size={15} />}
                                            Called
                                            {current.status === 'IN_SERVICE' && <span className="sr-only"> (complete)</span>}
                                        </li>
                                        <li aria-current={current.status === 'IN_SERVICE' ? 'step' : undefined}>
                                            <Play aria-hidden="true" size={15} /> Serving
                                        </li>
                                    </ol>
                                </div>
                                <div className="staff-controls">
                                    {current.status === 'CALLED' ? (
                                        <>
                                            <Button className="staff-primary" disabled={blocked} onClick={() => run('start', current.id)}>
                                                <Play aria-hidden="true" size={16} />
                                                {pendingAction === 'start' ? 'Starting…' : 'Start service'}
                                            </Button>
                                            <div className="actions">
                                                <Button variant="secondary" disabled={blocked} onClick={() => showDialog('skip')}>
                                                    <SkipForward aria-hidden="true" size={15} /> Skip token
                                                </Button>
                                                <Button variant="secondary" disabled={blocked} onClick={() => showDialog('no-show')}>
                                                    <UserX aria-hidden="true" size={15} /> Mark no-show
                                                </Button>
                                            </div>
                                        </>
                                    ) : (
                                        <Button className="staff-primary" disabled={blocked} onClick={() => run('complete', current.id)}>
                                            <Check aria-hidden="true" size={17} />
                                            {pendingAction === 'complete' ? 'Completing…' : 'Complete service'}
                                        </Button>
                                    )}
                                </div>
                            </>
                        ) : (
                            <div className="staff-standby">
                                <div className="staff-counter-icon">
                                    {counter.status === 'CLOSED'
                                        ? <Power aria-hidden="true" size={22} />
                                        : <BellRing aria-hidden="true" size={22} />}
                                </div>
                                <h3>
                                    {counter.status === 'CLOSED'
                                        ? 'Counter is closed'
                                        : waiting.length > 0 ? 'Ready to call' : 'Waiting for students'}
                                </h3>
                                <p>
                                    {counter.status === 'CLOSED'
                                        ? 'Open this counter to serve the queue.'
                                        : waiting.length > 0
                                            ? 'Call the first token in the waiting queue.'
                                            : 'The next student will appear in the waiting queue.'}
                                </p>
                                {counter.status === 'CLOSED' && (
                                    <Button className="staff-primary" disabled={blocked} onClick={() => run('open')}>
                                        <Power aria-hidden="true" size={16} />
                                        {pendingAction === 'open' ? 'Opening…' : 'Open counter'}
                                    </Button>
                                )}
                                {counter.status === 'OPEN' && waiting.length > 0 && (
                                    <Button className="staff-primary" disabled={blocked} onClick={() => run('call-next')}>
                                        {pendingAction === 'call-next' ? 'Calling…' : 'Call next token'}
                                        <ArrowRight aria-hidden="true" size={17} />
                                    </Button>
                                )}
                            </div>
                        )}
                    </Panel>

                    <Panel title="Waiting queue" actions={(
                        <span className="staff-queue-count">
                            <UsersRound aria-hidden="true" size={16} /> {waiting.length} waiting
                        </span>
                    )}>
                        {waiting.length > 0 ? (
                            <div className="table-wrap staff-waiting" role="region" aria-label="Waiting tokens" tabIndex={0}>
                                <table className="data-table">
                                    <caption className="sr-only">Waiting tokens in call order. Issue times use campus local time.</caption>
                                    <thead>
                                        <tr><th scope="col">Place</th><th scope="col">Token</th><th scope="col">Issued</th></tr>
                                    </thead>
                                    <tbody>
                                        {waiting.map((token, index) => (
                                            <tr key={token.id}>
                                                <td>{token.position}</td>
                                                <th scope="row" className="staff-waiting-token">
                                                    {token.tokenNumber}
                                                    {index === 0 && <span className="staff-next-tag">Next in line</span>}
                                                </th>
                                                <td>
                                                    <time dateTime={token.issuedAt} title={token.queueDate}>
                                                        {campusClock.format(new Date(token.issuedAt))}
                                                    </time>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <Empty title="No students waiting" />
                        )}
                    </Panel>
                </div>
            )}

            {activeDialog && (
                <ConfirmDialog
                    title={dialogCopy[activeDialog.action].title}
                    description={dialogCopy[activeDialog.action].description}
                    confirmLabel={dialogCopy[activeDialog.action].label}
                    onConfirm={confirmAction}
                    onClose={() => setDialog(null)}
                    busy={Boolean(pendingAction)}
                >
                    {activeDialog.action === 'skip' && (
                        <div className="field">
                            <label htmlFor="staff-skip-reason">Reason for skipping</label>
                            <textarea
                                id="staff-skip-reason"
                                rows={3}
                                maxLength={500}
                                required
                                disabled={Boolean(pendingAction)}
                                aria-invalid={Boolean(reasonError)}
                                aria-describedby={reasonError ? 'staff-skip-error' : undefined}
                                value={reason}
                                onChange={(event) => {
                                    setReason(event.target.value);
                                    setReasonError('');
                                }}
                            />
                            {reasonError && <p id="staff-skip-error" role="alert">{reasonError}</p>}
                        </div>
                    )}
                </ConfirmDialog>
            )}
        </div>
    );
}

export default function Staff() {
    const assignments = useQuery('/staff/counters', { interval: 8_000 });
    const counter = assignments.data?.[0];

    return (
        <>
            <PageHeading title="Counter workspace" />
            {assignments.error && (
                <div className="actions">
                    <Feedback error={assignments.error} />
                    <Button variant="secondary" onClick={assignments.refresh}>Retry assignments</Button>
                </div>
            )}
            {assignments.loading && !assignments.data && <Feedback message="Loading your counter assignment…" />}
            {!assignments.loading && !assignments.error && !counter && (
                <Panel><Empty title="No counter assigned" description="Ask an administrator to assign you a counter." /></Panel>
            )}
            {counter && (
                <CounterWorkspace
                    key={counter.id}
                    assignedCounter={counter}
                    refreshAssignment={assignments.refresh}
                    assignmentUnavailable={Boolean(assignments.error)}
                />
            )}
        </>
    );
}
