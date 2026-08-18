import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { IScannerControls } from '@zxing/browser'
import type { AdminCheckInRecord } from '@panshi/contracts'
import type { AdminClient } from '../api/admin-client'

const stateLabels = { not_checked_in: '待报到', checked_in: '已报到', revoked: '已撤销' } as const

export function CheckInPage({ client }: { client: AdminClient }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const controlsRef = useRef<IScannerControls | null>(null)
  const processingRef = useRef(false)
  const [cameraActive, setCameraActive] = useState(false)
  const [code, setCode] = useState('')
  const [record, setRecord] = useState<AdminCheckInRecord | null>(null)
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState(false)
  const [revokeReason, setRevokeReason] = useState('')

  useEffect(() => () => controlsRef.current?.stop(), [])
  const lookup = async (value: string) => {
    const normalized = value.trim()
    if (!normalized || processingRef.current) return
    processingRef.current = true; setPending(true); setMessage('')
    try { const response = await client.lookupCheckIn(normalized); setRecord(response.data); setCode(normalized) }
    catch (error) { setRecord(null); setMessage(error instanceof Error ? error.message : '报到码查询失败') }
    finally { processingRef.current = false; setPending(false) }
  }
  const startCamera = async () => {
    setMessage('')
    try {
      const { BrowserQRCodeReader } = await import('@zxing/browser')
      const reader = new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 350 })
      if (!videoRef.current) return
      controlsRef.current = await reader.decodeFromVideoDevice(undefined, videoRef.current, (result) => {
        if (result) void lookup(result.getText())
      })
      setCameraActive(true)
    } catch (error) { setMessage(error instanceof Error ? `无法启用摄像头：${error.message}` : '无法启用摄像头') }
  }
  const stopCamera = () => { controlsRef.current?.stop(); controlsRef.current = null; setCameraActive(false) }
  const submitLookup = (event: FormEvent) => { event.preventDefault(); void lookup(code) }
  const confirm = async () => {
    if (!record || pending) return
    setPending(true); setMessage('')
    try { const response = await client.confirmCheckIn(record.credentialId, record.revision); setRecord(response.data); setMessage(response.data.duplicate ? '该学员已报到，未重复记录。' : '已确认报到。') }
    catch (error) { setMessage(error instanceof Error ? error.message : '确认报到失败') }
    finally { setPending(false) }
  }
  const revoke = async () => {
    if (!record || pending || revokeReason.trim().length < 2) return
    setPending(true); setMessage('')
    try { const response = await client.revokeCheckIn(record.credentialId, record.revision, revokeReason); setRecord(response.data); setRevokeReason(''); setMessage('已撤销报到记录。') }
    catch (error) { setMessage(error instanceof Error ? error.message : '撤销报到失败') }
    finally { setPending(false) }
  }

  return <section className="page-section check-in-admin"><div className="page-heading"><div><p>报到管理</p><h1>现场扫码报到</h1></div></div>{message ? <p className="operation-message" role="status">{message}</p> : null}<div className="check-in-admin__grid"><section className="panel check-in-scanner"><div className="section-heading"><h2>扫描学员报到码</h2>{cameraActive ? <button className="button-secondary" onClick={stopCamera}>关闭摄像头</button> : <button onClick={() => void startCamera()}>启用摄像头</button>}</div><div className={`check-in-video ${cameraActive ? 'is-active' : ''}`}><video ref={videoRef} muted playsInline />{!cameraActive ? <p>点击“启用摄像头”扫描二维码</p> : null}</div><form className="check-in-manual" onSubmit={submitLookup}><label>也可粘贴或输入报到码<input value={code} onChange={(event) => setCode(event.target.value)} placeholder="报到码或二维码内容" /></label><button disabled={pending || code.trim() === ''}>查询</button></form></section><section className="panel check-in-result"><h2>学员信息</h2>{record ? <><span className={`check-in-state check-in-state--${record.checkInState}`}>{stateLabels[record.checkInState]}</span><dl><div><dt>姓名</dt><dd>{record.name}</dd></div><div><dt>手机号</dt><dd>{record.phone}</dd></div><div><dt>单位</dt><dd>{record.organization || '未填写'}</dd></div><div><dt>院系／培养单位</dt><dd>{record.department || '未填写'}</dd></div><div><dt>身份</dt><dd>{record.identityType || '未填写'}</dd></div>{record.firstCheckedInAt ? <div><dt>首次报到</dt><dd>{new Date(record.firstCheckedInAt).toLocaleString('zh-CN')}<small>{record.firstCheckedInBy ? `，操作人：${record.firstCheckedInBy}` : ''}</small></dd></div> : null}{record.revokeReason ? <div><dt>撤销原因</dt><dd>{record.revokeReason}</dd></div> : null}</dl>{record.checkInState !== 'checked_in' ? <button className="check-in-confirm" disabled={pending} onClick={() => void confirm()}>确认报到</button> : <div className="check-in-revoke"><label>撤销原因<input value={revokeReason} onChange={(event) => setRevokeReason(event.target.value)} placeholder="请说明撤销原因" /></label><button className="button-danger" disabled={pending || revokeReason.trim().length < 2} onClick={() => void revoke()}>撤销报到</button></div>}</> : <p className="empty-state">扫码或输入报到码后，此处显示学员信息。查询本身不会完成报到。</p>}</section></div></section>
}
