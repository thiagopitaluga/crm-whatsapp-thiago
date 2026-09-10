'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle2, Loader2, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

declare global {
  interface Window {
    FB?: {
      init: (options: Record<string, unknown>) => void
      login: (
        callback: (response: { authResponse?: { code?: string } }) => void,
        options: Record<string, unknown>,
      ) => void
    }
  }
}

type SignupData = { phone_number_id: string; waba_id: string }

const appId = process.env.NEXT_PUBLIC_META_APP_ID
const configId = process.env.NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID

export function EmbeddedWhatsAppSignup({
  disabled,
  onConnected,
}: {
  disabled?: boolean
  onConnected: () => void
}) {
  const [sdkReady, setSdkReady] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const codeRef = useRef<string | null>(null)
  const signupRef = useRef<SignupData | null>(null)
  const connectingRef = useRef(false)

  const completeIfReady = useCallback(async () => {
    const code = codeRef.current
    const signup = signupRef.current
    if (!code || !signup || !connectingRef.current) return
    codeRef.current = null
    signupRef.current = null
    try {
      const response = await fetch('/api/whatsapp/embedded-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, ...signup }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Não foi possível concluir a conexão.')
      toast.success(`WhatsApp ${data.phone.display_phone_number} conectado.`)
      onConnected()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível concluir a conexão.')
    } finally {
      connectingRef.current = false
      setConnecting(false)
    }
  }, [onConnected])

  useEffect(() => {
    if (!appId || !configId) return
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== 'https://www.facebook.com' && event.origin !== 'https://web.facebook.com') return
      let payload: unknown = event.data
      if (typeof payload === 'string') {
        try {
          payload = JSON.parse(payload)
        } catch {
          return
        }
      }
      const eventPayload = payload as {
        type?: string
        event?: string
        data?: Partial<SignupData>
      }
      if (eventPayload.type !== 'WA_EMBEDDED_SIGNUP') return
      if (eventPayload.event === 'FINISH' && eventPayload.data?.phone_number_id && eventPayload.data?.waba_id) {
        signupRef.current = {
          phone_number_id: eventPayload.data.phone_number_id,
          waba_id: eventPayload.data.waba_id,
        }
        void completeIfReady()
      } else if (eventPayload.event === 'CANCEL') {
        connectingRef.current = false
        setConnecting(false)
        toast.message('A conexão com a Meta foi cancelada.')
      }
    }
    window.addEventListener('message', onMessage)
    const existing = document.getElementById('facebook-jssdk') as HTMLScriptElement | null
    const initialise = () => {
      window.FB?.init({ appId, cookie: true, xfbml: false, version: 'v21.0' })
      setSdkReady(Boolean(window.FB))
    }
    if (existing) {
      if (window.FB) initialise()
      else existing.addEventListener('load', initialise, { once: true })
    } else {
      const script = document.createElement('script')
      script.id = 'facebook-jssdk'
      script.src = 'https://connect.facebook.net/pt_BR/sdk.js'
      script.async = true
      script.onload = initialise
      document.body.appendChild(script)
    }
    return () => window.removeEventListener('message', onMessage)
  }, [completeIfReady])

  function connect() {
    if (!window.FB || !configId) {
      toast.error('O conector da Meta ainda está carregando. Tente novamente em instantes.')
      return
    }
    connectingRef.current = true
    setConnecting(true)
    window.FB.login(
      (response) => {
        const code = response.authResponse?.code
        if (!code) {
          connectingRef.current = false
          setConnecting(false)
          toast.error('A Meta não autorizou a conexão.')
          return
        }
        codeRef.current = code
        // FINISH may arrive just before or after the login callback.
        void completeIfReady()
      },
      {
        config_id: configId,
        response_type: 'code',
        override_default_response_type: true,
        extras: { setup: {}, featureType: 'whatsapp_business_app_onboarding' },
      },
    )
  }

  if (!appId || !configId) return null

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <ShieldCheck className="size-5 text-primary" />
          Conexão oficial com a Meta
        </CardTitle>
        <CardDescription className="text-muted-foreground">
          Conecte o número da empresa sem copiar token ou ID manualmente. O acesso é salvo criptografado neste CRM.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-3">
        <Button onClick={connect} disabled={disabled || connecting || !sdkReady}>
          {connecting ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
          {connecting ? 'Conectando…' : 'Conectar com Meta'}
        </Button>
        {!sdkReady && <span className="text-xs text-muted-foreground">Preparando conector seguro…</span>}
      </CardContent>
    </Card>
  )
}
