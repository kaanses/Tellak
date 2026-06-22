import { render, screen, fireEvent, act } from "@testing-library/react";
import { ToastContainer } from "../shared/components/ToastContainer";
import { useToastStore } from "../shared/store/toastStore";

beforeEach(() => {
    act(() => useToastStore.setState({ toasts: [] }));
});

describe("ToastContainer", () => {
    it("renders a toast added to the store", () => {
        render(<ToastContainer />);
        act(() => useToastStore.getState().addToast("Something broke", "error"));
        expect(screen.getByText("Something broke")).toBeInTheDocument();
    });

    it("renders multiple toasts in order", () => {
        render(<ToastContainer />);
        act(() => {
            useToastStore.getState().addToast("first", "info");
            useToastStore.getState().addToast("second", "success");
        });
        expect(screen.getByText("first")).toBeInTheDocument();
        expect(screen.getByText("second")).toBeInTheDocument();
    });

    it("removes a toast when its dismiss button is clicked", () => {
        render(<ToastContainer />);
        act(() => useToastStore.getState().addToast("dismiss me", "error"));
        fireEvent.click(screen.getByText("✕"));
        expect(screen.queryByText("dismiss me")).not.toBeInTheDocument();
    });
});
