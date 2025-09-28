'use client';

import { useState } from 'react';

interface SSEMessage {
  type: string;
  phase?: string;
  stepId?: string;
  content?: any;
  result?: any;
  output?: any;
  error?: string;
  message?: string;
  status?: string;
  timestamp?: string;
  startedAt?: number;
  endedAt?: number;
}

export default function WorkflowUI() {
  const [recordId, setRecordId] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [messages, setMessages] = useState<SSEMessage[]>([]);

  const startWorkflow = async () => {
    if (!recordId.trim()) {
      alert('レコードIDを入力してください');
      return;
    }

    setIsRunning(true);
    setMessages([]);

    try {
      const response = await fetch('/api/workflow/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ recordId: recordId.trim() }),
      });

      if (!response.ok) {
        throw new Error('ワークフローの開始に失敗しました');
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('ストリームの取得に失敗しました');
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value);
        const lines = text.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              console.log('Received message:', data); // デバッグ用
              setMessages(prev => [...prev, data]);
            } catch (e) {
              console.error('Parse error:', e);
            }
          }
        }
      }
    } catch (error) {
      console.error('Error:', error);
      setMessages(prev => [...prev, {
        type: 'error',
        error: error instanceof Error ? error.message : 'エラーが発生しました'
      }]);
    } finally {
      setIsRunning(false);
    }
  };

  const renderMessage = (msg: SSEMessage, index: number) => {
    const phaseColors = {
      phase1a: 'border-blue-500',
      phase1b: 'border-green-500',
      phase2: 'border-purple-500',
      phase3: 'border-orange-500',
    };

    const phaseNames = {
      phase1a: 'Phase 1A: 重い画像OCR',
      phase1b: 'Phase 1B: 軽量OCR',
      phase2: 'Phase 2: 外部調査',
      phase3: 'Phase 3: 最終分析',
    };
    
    const stepIdToPhase: Record<string, {phase: string, name: string}> = {
      'phase1a-heavy-ocr': { phase: 'phase1a', name: 'Phase 1A: 重い画像OCR処理' },
      'phase1b-light-ocr': { phase: 'phase1b', name: 'Phase 1B: 軽量OCR処理' },
      'phase2-external-research': { phase: 'phase2', name: 'Phase 2: 外部調査' },
      'phase3-final-analysis': { phase: 'phase3', name: 'Phase 3: 最終分析' },
    };

    // step_detailとstep_errorの表示を処理
    if (msg.type === 'step_detail' && msg.stepId) {
      const stepInfo = stepIdToPhase[msg.stepId];
      if (!stepInfo) return null;
      
      const borderColor = phaseColors[stepInfo.phase as keyof typeof phaseColors];
      
      return (
        <div key={index} className={`border-l-4 ${borderColor} pl-4 mb-4 bg-gray-50 p-4 rounded-r`}>
          <div className="font-bold text-lg mb-2">{stepInfo.name} - 詳細結果</div>
          <div className="text-sm text-gray-600 mb-2">
            実行時間: {msg.startedAt && msg.endedAt ? `${((msg.endedAt - msg.startedAt) / 1000).toFixed(2)}秒` : '-'}
          </div>
          
          {msg.output && (
            <div className="space-y-4">
              {/* ocrHeavyResults の表示 */}
              {msg.output.ocrHeavyResults && (
                <div className="bg-white p-4 rounded border">
                  <h4 className="font-semibold mb-2">📄 OCR Heavy Results (請求書・通帳)</h4>
                  <div className="whitespace-pre-wrap text-sm max-h-96 overflow-y-auto">
                    {msg.output.ocrHeavyResults}
                  </div>
                </div>
              )}
              
              {/* ocrLightResults の表示 */}
              {msg.output.ocrLightResults && (
                <div className="bg-white p-4 rounded border">
                  <h4 className="font-semibold mb-2">📑 OCR Light Results (本人確認・登記簿)</h4>
                  <div className="whitespace-pre-wrap text-sm max-h-96 overflow-y-auto">
                    {msg.output.ocrLightResults}
                  </div>
                </div>
              )}
              
              {/* phase2Results の表示 */}
              {msg.output.phase2Results && (
                <div className="bg-white p-4 rounded border">
                  <h4 className="font-semibold mb-2">🔍 外部調査結果</h4>
                  <div className="whitespace-pre-wrap text-sm max-h-96 overflow-y-auto">
                    {msg.output.phase2Results}
                  </div>
                </div>
              )}
              
              {/* finalReport の表示 */}
              {msg.output.finalReport && (
                <div className="bg-white p-4 rounded border">
                  <h4 className="font-semibold mb-2">📊 最終分析レポート</h4>
                  <div className="whitespace-pre-wrap text-sm max-h-96 overflow-y-auto">
                    {msg.output.finalReport}
                  </div>
                </div>
              )}
              
              {/* recommendation の表示 */}
              {msg.output.recommendation && (
                <div className="bg-yellow-100 p-3 rounded mt-2">
                  <span className="font-semibold">推奨判定: </span>
                  <span className="text-lg">{msg.output.recommendation}</span>
                </div>
              )}
              
              {/* その他のデータをJSON形式で表示 */}
              {Object.keys(msg.output).filter(key => 
                !['ocrHeavyResults', 'ocrLightResults', 'phase2Results', 'finalReport', 'recommendation', 'recordId'].includes(key)
              ).length > 0 && (
                <details className="mt-4">
                  <summary className="cursor-pointer text-sm text-gray-600 font-semibold">その他のデータを表示</summary>
                  <pre className="mt-2 p-4 bg-white rounded border text-xs overflow-auto">
                    {JSON.stringify(
                      Object.fromEntries(
                        Object.entries(msg.output).filter(([key]) => 
                          !['ocrHeavyResults', 'ocrLightResults', 'phase2Results', 'finalReport', 'recommendation', 'recordId'].includes(key)
                        )
                      ), 
                      null, 
                      2
                    )}
                  </pre>
                </details>
              )}
            </div>
          )}
        </div>
      );
    }

    // step_errorの表示
    if (msg.type === 'step_error' && msg.stepId) {
      const stepInfo = stepIdToPhase[msg.stepId];
      if (!stepInfo) return null;
      
      return (
        <div key={index} className="border-l-4 border-red-500 pl-4 mb-4 bg-red-50 p-4 rounded-r">
          <div className="font-bold text-lg mb-2 text-red-700">{stepInfo.name} - エラー</div>
          <div className="text-sm text-gray-600 mb-2">
            実行時間: {msg.startedAt && msg.endedAt ? `${((msg.endedAt - msg.startedAt) / 1000).toFixed(2)}秒` : '-'}
          </div>
          <div className="bg-white p-4 rounded border border-red-300">
            <pre className="whitespace-pre-wrap text-sm text-red-600">
              {msg.error}
            </pre>
          </div>
        </div>
      );
    }

    if (msg.type === 'error') {
      return (
        <div key={index} className="bg-red-50 border-l-4 border-red-500 p-4 mb-4">
          <div className="text-red-700">エラー: {msg.error}</div>
        </div>
      );
    }

    if (msg.type === 'start') {
      return (
        <div key={index} className="bg-gray-100 p-4 mb-4 rounded">
          <div className="font-semibold">🚀 {msg.message}</div>
        </div>
      );
    }

    if (msg.type === 'complete') {
      return (
        <div key={index} className="bg-green-50 border-l-4 border-green-500 p-4 mb-4">
          <div className="font-semibold text-green-700 mb-2">✅ ワークフロー完了</div>
          <div className="mt-4">
            <h3 className="font-bold text-lg mb-2">最終レポート</h3>
            <div className="whitespace-pre-wrap text-sm leading-relaxed bg-white p-4 rounded border max-h-96 overflow-y-auto">
              {msg.result?.finalReport || msg.result?.executionResult?.finalReport || 'レポートが生成されませんでした'}
            </div>
            {(msg.result?.recommendation || msg.result?.executionResult?.recommendation) && (
              <div className="mt-4 p-3 bg-yellow-100 rounded">
                <span className="font-semibold">推奨判定: </span>
                <span className="text-lg">{msg.result.recommendation || msg.result.executionResult.recommendation}</span>
              </div>
            )}
            {/* 詳細な実行結果も表示 */}
            {msg.result?.executionResult && (
              <details className="mt-4">
                <summary className="cursor-pointer text-sm text-gray-600">詳細な実行結果を表示</summary>
                <pre className="mt-2 p-2 bg-gray-50 text-xs overflow-auto whitespace-pre-wrap max-h-64">
                  {JSON.stringify(msg.result.executionResult, null, 2)}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }

    const borderColor = msg.phase ? phaseColors[msg.phase as keyof typeof phaseColors] : 'border-gray-300';
    const phaseName = msg.phase ? phaseNames[msg.phase as keyof typeof phaseNames] : '';

    return (
      <div key={index} className={`border-l-4 ${borderColor} pl-4 mb-4`}>
        {phaseName && <div className="font-semibold text-sm mb-1">{phaseName}</div>}
        
        {msg.type === 'phase_start' && (
          <div className="text-gray-600">▶️ {msg.content?.message}</div>
        )}
        
        {msg.type === 'phase_complete' && (
          <div>
            <div className="text-gray-600">✓ {msg.content?.message}</div>
            {msg.content?.result && (
              <details className="mt-2">
                <summary className="cursor-pointer text-sm text-gray-600">フェーズ結果を表示</summary>
                <pre className="mt-2 p-2 bg-gray-50 text-xs overflow-auto whitespace-pre-wrap">
                  {typeof msg.content.result === 'string' ? msg.content.result : JSON.stringify(msg.content.result, null, 2)}
                </pre>
              </details>
            )}
          </div>
        )}
        
        {msg.type === 'tool_start' && (
          <div className="text-gray-500 ml-4">🔧 {msg.content?.toolName} 実行中...</div>
        )}
        
        {msg.type === 'tool_complete' && (
          <div className="ml-4">
            <div className="text-gray-500">✓ {msg.content?.toolName} 完了</div>
            {msg.content?.result && (
              <details className="mt-2">
                <summary className="cursor-pointer text-sm text-gray-600">結果を表示</summary>
                <pre className="mt-2 p-2 bg-gray-50 text-xs overflow-auto">
                  {JSON.stringify(msg.content.result, null, 2)}
                </pre>
              </details>
            )}
          </div>
        )}
        
        {msg.type === 'agent_response' && (
          <div className="ml-4 mt-2">
            <details open>
              <summary className="cursor-pointer font-medium mb-2">エージェント応答</summary>
              <div className="whitespace-pre-wrap bg-gray-50 p-3 rounded text-sm">
                {msg.content?.response}
              </div>
            </details>
          </div>
        )}
        
        {msg.type === 'info' && (
          <div className="text-gray-600 bg-blue-50 p-3 rounded border-l-4 border-blue-400">
            ℹ️ {msg.content?.message}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">コンプライアンス審査ワークフロー</h1>
        
        <div className="bg-white rounded-lg shadow p-6 mb-8">
          <div className="flex gap-4">
            <input
              type="text"
              value={recordId}
              onChange={(e) => setRecordId(e.target.value)}
              placeholder="レコードIDを入力"
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={isRunning}
            />
            <button
              onClick={startWorkflow}
              disabled={isRunning}
              className={`px-6 py-2 rounded-lg font-medium transition-colors ${
                isRunning
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-blue-500 text-white hover:bg-blue-600'
              }`}
            >
              {isRunning ? '実行中...' : 'ワークフロー実行'}
            </button>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">実行ログ</h2>
          <div className="space-y-2">
            {messages.length === 0 ? (
              <div className="text-gray-400 text-center py-8">
                レコードIDを入力してワークフローを実行してください
              </div>
            ) : (
              messages.map((msg, index) => renderMessage(msg, index))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}