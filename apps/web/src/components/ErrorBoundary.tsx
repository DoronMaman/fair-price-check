import { Component, type ReactNode } from 'react';

type Props = {
  children: ReactNode;
  /** Changing this clears a previous error (e.g. a new search). */
  resetKey: unknown;
};
type State = { failed: boolean };

/**
 * Contains a rendering bug to the results area: the search form above stays
 * usable and the next search clears it, instead of the whole page going blank.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    console.error('Results failed to render', error);
  }

  override componentDidUpdate(prev: Props): void {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return (
        <div role="alert" className="rounded-2xl bg-rose-50 p-4 text-rose-900 ring-1 ring-rose-200">
          לא הצלחנו להציג את התוצאה. נסו לחפש שוב.
        </div>
      );
    }
    return this.props.children;
  }
}
