import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LandingPage } from './LandingPage';

describe('LandingPage', () => {
  it('enters the mapping studio from the primary CTA', async () => {
    const user = userEvent.setup();
    const onEnterStudio = vi.fn();
    render(<LandingPage onEnterStudio={onEnterStudio} />);

    await user.click(screen.getByRole('button', { name: /enter mapping studio/i }));
    expect(onEnterStudio).toHaveBeenCalledTimes(1);
  });

  it('updates scenario details when use case selection changes', async () => {
    const user = userEvent.setup();
    render(<LandingPage onEnterStudio={vi.fn()} />);

    expect(screen.getByText(/map cif, dda, loan, and gl structures/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /secure environment bypass/i }));
    expect(screen.getByText(/ingest csv, json, or xml schema files directly/i)).toBeInTheDocument();
  });

  it('recalculates simulator metrics when complexity changes', () => {
    render(<LandingPage onEnterStudio={vi.fn()} />);

    const slider = screen.getByLabelText(/drag to simulate schema volume and mapping complexity/i);
    fireEvent.change(slider, { target: { value: '90' } });

    expect(screen.getByText('90%')).toBeInTheDocument();
    expect(screen.getByText('914')).toBeInTheDocument();
    expect(screen.getByText('72%')).toBeInTheDocument();
    expect(screen.getByText('205')).toBeInTheDocument();
    expect(screen.getByText('Estimated run: 3.58s')).toBeInTheDocument();
  });
});
