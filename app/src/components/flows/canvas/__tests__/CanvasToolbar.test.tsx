/**
 * CanvasToolbar — the floating top-left history/viewport pill rendered
 * inside `<ReactFlow>`. `@xyflow/react` is mocked here (rather than mounting
 * a real `<ReactFlow>` as `FlowCanvas.test.tsx`/`EditableFlowCanvas.test.tsx`
 * do) so `useReactFlow`'s zoom/fit calls can be asserted directly and `Panel`
 * doesn't need a real store context — this is a focused unit test of the
 * toolbar's own wiring, not an integration smoke test.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import CanvasToolbar from '../CanvasToolbar';
import { FLOW_FIT_VIEW_OPTIONS } from '../fitView';

const zoomIn = vi.hoisted(() => vi.fn());
const zoomOut = vi.hoisted(() => vi.fn());
const fitView = vi.hoisted(() => vi.fn());

vi.mock('@xyflow/react', () => ({
  Panel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useReactFlow: () => ({ zoomIn, zoomOut, fitView }),
}));

describe('CanvasToolbar', () => {
  it('renders zoom/fit controls but no history or open-panel affordance by default', () => {
    render(<CanvasToolbar />);
    expect(screen.getByTestId('flow-canvas-toolbar')).toBeInTheDocument();
    expect(screen.queryByTestId('flow-editor-undo')).not.toBeInTheDocument();
    expect(screen.queryByTestId('flow-editor-redo')).not.toBeInTheDocument();
    expect(screen.queryByTestId('flow-canvas-open-panel')).not.toBeInTheDocument();
  });

  it('calls zoomIn, zoomOut, and fitView with the shared fit options', () => {
    render(<CanvasToolbar />);

    // No `I18nProvider` mounted, so `useT()` falls back to the bundled
    // English strings (same fallback `EditableFlowCanvas.test.tsx` relies on).
    fireEvent.click(screen.getByLabelText('Zoom out'));
    expect(zoomOut).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByLabelText('Zoom in'));
    expect(zoomIn).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByLabelText('Fit to screen'));
    expect(fitView).toHaveBeenCalledWith(FLOW_FIT_VIEW_OPTIONS);
  });

  it('reflects history.canUndo/canRedo and fires the given callbacks', () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    render(<CanvasToolbar history={{ canUndo: true, canRedo: false, onUndo, onRedo }} />);

    const undo = screen.getByTestId('flow-editor-undo');
    const redo = screen.getByTestId('flow-editor-redo');
    expect(undo).not.toBeDisabled();
    expect(redo).toBeDisabled();

    fireEvent.click(undo);
    expect(onUndo).toHaveBeenCalledTimes(1);

    // Disabled button doesn't fire its handler.
    fireEvent.click(redo);
    expect(onRedo).not.toHaveBeenCalled();
  });

  it('disables undo when canUndo is false', () => {
    render(
      <CanvasToolbar
        history={{ canUndo: false, canRedo: true, onUndo: vi.fn(), onRedo: vi.fn() }}
      />
    );
    expect(screen.getByTestId('flow-editor-undo')).toBeDisabled();
    expect(screen.getByTestId('flow-editor-redo')).not.toBeDisabled();
  });

  it('renders the open-panel button and fires onOpenPanel when the side panel is collapsed', () => {
    const onOpenPanel = vi.fn();
    render(<CanvasToolbar onOpenPanel={onOpenPanel} />);

    const openButton = screen.getByTestId('flow-canvas-open-panel');
    expect(openButton).toBeInTheDocument();
    fireEvent.click(openButton);
    expect(onOpenPanel).toHaveBeenCalledTimes(1);
  });
});
