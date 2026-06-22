import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

class ErrorBoundary extends React.Component<
    { children: React.ReactNode },
    { error: Error | null }
> {
    state = { error: null as Error | null };

    static getDerivedStateFromError(error: Error) {
        return { error };
    }

    render() {
        if (this.state.error) {
            return (
                <div style={{ padding: 32, fontFamily: 'monospace' }}>
                    <h1 style={{ color: 'red' }}>App Error</h1>
                    <pre>{this.state.error.message}</pre>
                    <pre>{this.state.error.stack}</pre>
                </div>
            );
        }
        return this.props.children;
    }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
        <ErrorBoundary>
            <App />
        </ErrorBoundary>
    </React.StrictMode>,
);
