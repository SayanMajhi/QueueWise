import { useEffect, useId, useRef } from 'react';
import { CircleAlert, Inbox, X } from 'lucide-react';

const statusLabels = {
    WAITING: 'Waiting', CALLED: 'Called', IN_SERVICE: 'In service',
    COMPLETED: 'Completed', CANCELLED: 'Cancelled', SKIPPED: 'Skipped', NO_SHOW: 'No-show',
    OPEN: 'Open', CLOSED: 'Closed', DRAINING: 'Draining', ACTIVE: 'Accepting tokens', INACTIVE: 'Paused',
};

export function Badge({ status, children }) {
    return <span className={`status-badge status-${status?.toLowerCase() ?? 'neutral'}`}>
        <span className="status-dot" aria-hidden="true" />{children ?? statusLabels[status] ?? status}
    </span>;
}

export function Button({ variant = 'primary', className = '', type = 'button', ...props }) {
    return <button className={`button button-${variant} ${className}`} type={type} {...props} />;
}

export function PageHeading({ eyebrow, title, description, children }) {
    return <header className="page-heading">
        <div>
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            <h1>{title}</h1>
            {description && <p className="heading-description">{description}</p>}
        </div>
        {children && <div className="actions">{children}</div>}
    </header>;
}

export function Panel({ title, description, actions, children, className = '' }) {
    return <section className={`panel ${className}`}>
        {(title || description || actions) && <header className="panel-heading">
            <div>
                {title && <h2>{title}</h2>}
                {description && <p>{description}</p>}
            </div>
            {actions}
        </header>}
        {children}
    </section>;
}

export function Feedback({ error, message }) {
    if (!error && !message) return null;
    return <div className={`feedback ${error ? 'feedback-error' : 'feedback-info'}`} role={error ? 'alert' : 'status'}>
        <CircleAlert size={17} aria-hidden="true" /><span>{error?.message ?? error ?? message}</span>
    </div>;
}

export function Empty({ title, description, children }) {
    return <div className="empty-state">
        <span className="empty-icon"><Inbox size={20} aria-hidden="true" /></span>
        <strong>{title}</strong>
        {description && <p>{description}</p>}
        {children}
    </div>;
}

export function ConfirmDialog({ title, description, confirmLabel, onConfirm, onClose, busy, children }) {
    const dialogRef = useRef(null);
    const cancelRef = useRef(null);
    const descriptionId = useId();
    useEffect(() => {
        const dialog = dialogRef.current;
        dialog.showModal();
        cancelRef.current?.focus();
        return () => dialog.close();
    }, []);
    return <dialog ref={dialogRef} className="dialog" aria-label={title} aria-describedby={description ? descriptionId : undefined} onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
    }}>
        <div className="dialog-header">
            <h2>{title}</h2>
            <Button variant="quiet" aria-label="Close dialog" disabled={busy} onClick={onClose}><X size={19} /></Button>
        </div>
        {description && <p id={descriptionId} className="muted">{description}</p>}
        <form className="section-stack" onSubmit={(event) => { event.preventDefault(); onConfirm(); }}>
            {children}
            <div className="actions dialog-actions">
                <Button variant="secondary" ref={cancelRef} disabled={busy} onClick={onClose}>Go back</Button>
                <Button variant="danger" type="submit" disabled={busy}>{busy ? 'Saving…' : confirmLabel}</Button>
            </div>
        </form>
    </dialog>;
}
