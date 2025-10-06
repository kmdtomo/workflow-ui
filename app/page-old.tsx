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
      phase1: 'border-blue-500',
      phase2: 'border-green-500',
      phase3: 'border-purple-500',
      phase4: 'border-orange-500',
    };

    const phaseNames = {
      phase1: 'Phase 1: 買取・担保情報処理',
      phase2: 'Phase 2: 通帳分析',
      phase3: 'Phase 3: 本人確認・企業実在性確認',
      phase4: 'Phase 4: 最終分析・レポート生成',
    };

    const stepIdToPhase: Record<string, {phase: string, name: string}> = {
      'phase1-purchase-collateral': { phase: 'phase1', name: 'Phase 1: 買取・担保情報処理' },
      'phase2-bank-statement': { phase: 'phase2', name: 'Phase 2: 通帳分析' },
      'phase3-verification': { phase: 'phase3', name: 'Phase 3: 本人確認・企業実在性確認' },
      'phase4-final-analysis': { phase: 'phase4', name: 'Phase 4: 最終分析・レポート生成' },
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
              {/* Phase 1の結果表示 */}
              {msg.output.phase1Results && (
                <div className="bg-white p-4 rounded border">
                  <h4 className="font-semibold mb-2">📄 Phase 1: 買取・担保情報処理</h4>
                  <div className="whitespace-pre-wrap text-sm max-h-96 overflow-y-auto">
                    {typeof msg.output.phase1Results === 'string'
                      ? msg.output.phase1Results
                      : JSON.stringify(msg.output.phase1Results, null, 2)}
                  </div>
                </div>
              )}

              {/* Phase 2の結果表示 */}
              {msg.output.phase2Results && (
                <div className="bg-white p-4 rounded border">
                  <h4 className="font-semibold mb-2">📊 Phase 2: 通帳分析</h4>
                  <div className="whitespace-pre-wrap text-sm max-h-96 overflow-y-auto">
                    {typeof msg.output.phase2Results === 'string'
                      ? msg.output.phase2Results
                      : JSON.stringify(msg.output.phase2Results, null, 2)}
                  </div>
                </div>
              )}

              {/* Phase 3の結果表示 */}
              {msg.output.phase3Results && (
                <div className="bg-white p-4 rounded border">
                  <h4 className="font-semibold mb-2">🔍 Phase 3: 本人確認・企業実在性確認</h4>
                  <div className="whitespace-pre-wrap text-sm max-h-96 overflow-y-auto">
                    {typeof msg.output.phase3Results === 'string'
                      ? msg.output.phase3Results
                      : JSON.stringify(msg.output.phase3Results, null, 2)}
                  </div>
                </div>
              )}

              {/* Phase 4の結果表示（最終レポート） */}
              {msg.output.phase4Results && (
                <div className="bg-white p-4 rounded border">
                  <h4 className="font-semibold mb-2">✅ Phase 4: 最終分析・レポート</h4>

                  {/* 最終判定 */}
                  {msg.output.phase4Results.最終判定 && (
                    <div className="mb-4 p-3 bg-blue-50 rounded">
                      <span className="font-semibold">最終判定: </span>
                      <span className="text-xl font-bold">{msg.output.phase4Results.最終判定}</span>
                      {msg.output.phase4Results.リスクレベル && (
                        <span className="ml-4 text-sm text-gray-600">
                          ({msg.output.phase4Results.リスクレベル})
                        </span>
                      )}
                    </div>
                  )}

                  {/* 総評 */}
                  {msg.output.phase4Results.総評 && (
                    <div className="mb-4">
                      <h5 className="font-semibold mb-2">📝 総評</h5>
                      <div className="whitespace-pre-wrap text-sm bg-gray-50 p-3 rounded">
                        {msg.output.phase4Results.総評}
                      </div>
                    </div>
                  )}

                  {/* 審査サマリー */}
                  {msg.output.phase4Results.審査サマリー && (
                    <details className="mb-4">
                      <summary className="cursor-pointer font-semibold mb-2">📋 審査サマリー</summary>
                      <div className="ml-4 mt-2 text-sm space-y-1">
                        {Object.entries(msg.output.phase4Results.審査サマリー).map(([key, value]) => (
                          <div key={key}>
                            <span className="font-medium">{key}:</span> {String(value)}
                          </div>
                        ))}
                      </div>
                    </details>
                  )}

                  {/* 回収可能性評価 */}
                  {msg.output.phase4Results.回収可能性評価 && (
                    <details className="mb-4">
                      <summary className="cursor-pointer font-semibold mb-2">💰 回収可能性評価</summary>
                      <pre className="ml-4 mt-2 text-xs bg-gray-50 p-3 rounded overflow-auto">
                        {JSON.stringify(msg.output.phase4Results.回収可能性評価, null, 2)}
                      </pre>
                    </details>
                  )}

                  {/* 担保の安定性評価 */}
                  {msg.output.phase4Results.担保の安定性評価 && (
                    <details className="mb-4">
                      <summary className="cursor-pointer font-semibold mb-2">🏢 担保の安定性評価</summary>
                      <pre className="ml-4 mt-2 text-xs bg-gray-50 p-3 rounded overflow-auto">
                        {JSON.stringify(msg.output.phase4Results.担保の安定性評価, null, 2)}
                      </pre>
                    </details>
                  )}

                  {/* 申込者信頼性評価 */}
                  {msg.output.phase4Results.申込者信頼性評価 && (
                    <details className="mb-4">
                      <summary className="cursor-pointer font-semibold mb-2">👤 申込者信頼性評価</summary>
                      <pre className="ml-4 mt-2 text-xs bg-gray-50 p-3 rounded overflow-auto">
                        {JSON.stringify(msg.output.phase4Results.申込者信頼性評価, null, 2)}
                      </pre>
                    </details>
                  )}

                  {/* リスク要因評価 */}
                  {msg.output.phase4Results.リスク要因評価 && (
                    <details className="mb-4">
                      <summary className="cursor-pointer font-semibold mb-2">⚠️ リスク要因評価</summary>
                      <pre className="ml-4 mt-2 text-xs bg-gray-50 p-3 rounded overflow-auto">
                        {JSON.stringify(msg.output.phase4Results.リスク要因評価, null, 2)}
                      </pre>
                    </details>
                  )}

                  {/* 推奨事項 */}
                  {msg.output.phase4Results.推奨事項 && (
                    <details className="mb-4">
                      <summary className="cursor-pointer font-semibold mb-2">💡 推奨事項</summary>
                      <div className="ml-4 mt-2 text-sm">
                        {Array.isArray(msg.output.phase4Results.推奨事項) && (
                          <ul className="list-disc ml-4 space-y-2">
                            {msg.output.phase4Results.推奨事項.map((item: any, idx: number) => (
                              <li key={idx}>
                                <div className="font-medium">{item.対応策}</div>
                                <div className="text-gray-600 text-xs">
                                  優先度: {item.優先度} | {item.理由}
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </details>
                  )}
                </div>
              )}

              {/* その他のデータをJSON形式で表示 */}
              {Object.keys(msg.output).filter(key =>
                !['phase1Results', 'phase2Results', 'phase3Results', 'phase4Results', 'recordId'].includes(key)
              ).length > 0 && (
                <details className="mt-4">
                  <summary className="cursor-pointer text-sm text-gray-600 font-semibold">その他のデータを表示</summary>
                  <pre className="mt-2 p-4 bg-white rounded border text-xs overflow-auto">
                    {JSON.stringify(
                      Object.fromEntries(
                        Object.entries(msg.output).filter(([key]) =>
                          !['phase1Results', 'phase2Results', 'phase3Results', 'phase4Results', 'recordId'].includes(key)
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
      const phase4Results = msg.result?.phase4Results || msg.result?.executionResult?.phase4Results;

      return (
        <div key={index} className="bg-green-50 border-l-4 border-green-500 p-4 mb-4">
          <div className="font-semibold text-green-700 mb-2">✅ ワークフロー完了</div>

          {phase4Results ? (
            <div className="mt-4 space-y-4">
              {/* 最終判定 */}
              {phase4Results.最終判定 && (
                <div className="p-4 bg-white rounded border">
                  <span className="font-semibold text-lg">最終判定: </span>
                  <span className="text-2xl font-bold text-blue-600">{phase4Results.最終判定}</span>
                  {phase4Results.リスクレベル && (
                    <span className="ml-4 text-gray-600">({phase4Results.リスクレベル})</span>
                  )}
                </div>
              )}

              {/* 総評 */}
              {phase4Results.総評 && (
                <div className="bg-white p-4 rounded border">
                  <h3 className="font-bold text-lg mb-2">📝 総評</h3>
                  <div className="whitespace-pre-wrap text-sm leading-relaxed">
                    {phase4Results.総評}
                  </div>
                </div>
              )}

              {/* 審査サマリー */}
              {phase4Results.審査サマリー && (
                <details className="bg-white p-4 rounded border">
                  <summary className="cursor-pointer font-bold text-lg mb-2">📋 審査サマリー</summary>
                  <div className="mt-2 space-y-1 text-sm">
                    {Object.entries(phase4Results.審査サマリー).map(([key, value]) => (
                      <div key={key}>
                        <span className="font-medium">{key}:</span> {String(value)}
                      </div>
                    ))}
                  </div>
                </details>
              )}

              {/* カテゴリ別評価 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {phase4Results.回収可能性評価 && (
                  <details className="bg-white p-4 rounded border">
                    <summary className="cursor-pointer font-semibold">💰 回収可能性評価</summary>
                    <pre className="mt-2 text-xs overflow-auto max-h-64">
                      {JSON.stringify(phase4Results.回収可能性評価, null, 2)}
                    </pre>
                  </details>
                )}

                {phase4Results.担保の安定性評価 && (
                  <details className="bg-white p-4 rounded border">
                    <summary className="cursor-pointer font-semibold">🏢 担保の安定性評価</summary>
                    <pre className="mt-2 text-xs overflow-auto max-h-64">
                      {JSON.stringify(phase4Results.担保の安定性評価, null, 2)}
                    </pre>
                  </details>
                )}

                {phase4Results.申込者信頼性評価 && (
                  <details className="bg-white p-4 rounded border">
                    <summary className="cursor-pointer font-semibold">👤 申込者信頼性評価</summary>
                    <pre className="mt-2 text-xs overflow-auto max-h-64">
                      {JSON.stringify(phase4Results.申込者信頼性評価, null, 2)}
                    </pre>
                  </details>
                )}

                {phase4Results.リスク要因評価 && (
                  <details className="bg-white p-4 rounded border">
                    <summary className="cursor-pointer font-semibold">⚠️ リスク要因評価</summary>
                    <pre className="mt-2 text-xs overflow-auto max-h-64">
                      {JSON.stringify(phase4Results.リスク要因評価, null, 2)}
                    </pre>
                  </details>
                )}
              </div>

              {/* 推奨事項 */}
              {phase4Results.推奨事項 && Array.isArray(phase4Results.推奨事項) && (
                <div className="bg-white p-4 rounded border">
                  <h3 className="font-bold text-lg mb-2">💡 推奨事項</h3>
                  <ul className="list-disc ml-6 space-y-3">
                    {phase4Results.推奨事項.map((item: any, idx: number) => (
                      <li key={idx}>
                        <div className="font-medium">{item.対応策}</div>
                        <div className="text-sm text-gray-600">
                          <span className="font-semibold">優先度:</span> {item.優先度} |{' '}
                          <span className="font-semibold">理由:</span> {item.理由}
                        </div>
                        {item.期待効果 && (
                          <div className="text-sm text-gray-600">
                            <span className="font-semibold">期待効果:</span> {item.期待効果}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <div className="mt-4">
              <h3 className="font-bold text-lg mb-2">最終レポート</h3>
              <div className="whitespace-pre-wrap text-sm leading-relaxed bg-white p-4 rounded border max-h-96 overflow-y-auto">
                {msg.result?.finalReport || msg.result?.executionResult?.finalReport || 'レポートが生成されませんでした'}
              </div>
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