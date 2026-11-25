'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

export function AbacateCheckoutButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function openCheckout() {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/billing/abacatepay/checkout', {
        method: 'POST',
      });
      const data = await response.json();
      if (!response.ok || typeof data.url !== 'string') {
        setError(data.error || 'Não foi possível abrir o checkout.');
        return;
      }
      window.location.assign(data.url);
    } catch {
      setError(
        'Não foi possível conectar ao checkout de teste. Tente novamente.'
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        disabled={loading}
        onClick={() => void openCheckout()}
      >
        {loading ? 'Abrindo checkout…' : 'Abrir checkout de teste'}
      </Button>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
