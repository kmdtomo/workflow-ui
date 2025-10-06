'use client';

import { useState, useEffect } from 'react';

interface PhaseStatus {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  startTime?: number;
  endTime?: number;
}

export default function WorkflowUI() {
  const [recordId, setRecordId] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [phases, setPhases] = useState<PhaseStatus[]>([]);
  const [finalResult, setFinalResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const phaseDefinitions = {
    'parallel-phase123-step': 'Phase 1-3: 並列分析中（買取・担保 / 通帳 / 本人確認）',
    'phase4-report-generation': 'Phase 4: 最終分析・レポート生成',
    // 下位互換性のため残す
    phase1: 'Phase 1: 買取・担保情報処理',
    phase2: 'Phase 2: 通帳分析',
    phase3: 'Phase 3: 本人確認・企業実在性確認',
    phase4: 'Phase 4: 最終分析・レポート生成',
  };

  const startWorkflow = async () => {
    if (!recordId.trim()) {
      alert('レコードIDを入力してください');
      return;
    }

    setIsRunning(true);
    setPhases([]);
    setFinalResult(null);
    setError(null);

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
              console.log('📨 受信イベント:', data);

              // フェーズ開始
              if (data.type === 'phase_start' && data.phase) {
                console.log('▶️ フェーズ開始:', data.phase);
                setPhases(prev => {
                  const exists = prev.find(p => p.id === data.phase);
                  if (exists) {
                    return prev.map(p =>
                      p.id === data.phase
                        ? { ...p, status: 'running', startTime: Date.now() }
                        : p
                    );
                  } else {
                    return [...prev, {
                      id: data.phase,
                      name: phaseDefinitions[data.phase as keyof typeof phaseDefinitions] || data.phase,
                      status: 'running',
                      startTime: Date.now()
                    }];
                  }
                });
              }

              // フェーズ完了
              if (data.type === 'phase_complete' && data.phase) {
                console.log('✅ フェーズ完了:', data.phase);
                setPhases(prev => prev.map(p =>
                  p.id === data.phase
                    ? { ...p, status: 'completed', endTime: Date.now() }
                    : p
                ));
              }

              // エラー
              if (data.type === 'step_error') {
                console.log('❌ エラー:', data);
                if (data.phase) {
                  setPhases(prev => prev.map(p =>
                    p.id === data.phase
                      ? { ...p, status: 'error' }
                      : p
                  ));
                }
                setError(data.message || data.error || 'エラーが発生しました');
              }

              // 最終結果
              if (data.type === 'complete' && data.result) {
                console.log('🎉 ワークフロー完了:', data.result);
                console.log('🔍 phase4Results:', data.result.phase4Results);
                console.log('🔍 データ構造:', Object.keys(data.result));
                setFinalResult(data.result);
              }

            } catch (e) {
              console.error('Parse error:', e);
            }
          }
        }
      }
    } catch (error) {
      console.error('Error:', error);
      setError(error instanceof Error ? error.message : 'エラーが発生しました');
    } finally {
      setIsRunning(false);
    }
  };

  const getStatusIcon = (status: PhaseStatus['status']) => {
    switch (status) {
      case 'running':
        return '⏳';
      case 'completed':
        return '✅';
      case 'error':
        return '❌';
      default:
        return '⭕';
    }
  };

  const getStatusColor = (status: PhaseStatus['status']) => {
    switch (status) {
      case 'running':
        return 'bg-blue-100 border-blue-500';
      case 'completed':
        return 'bg-green-100 border-green-500';
      case 'error':
        return 'bg-red-100 border-red-500';
      default:
        return 'bg-gray-100 border-gray-300';
    }
  };

  const renderData = (data: any, depth = 0): React.ReactNode => {
    if (data === null || data === undefined) return <span className="text-gray-400">-</span>;

    // 文字列・数値・真偽値
    if (typeof data === 'string' || typeof data === 'number' || typeof data === 'boolean') {
      // 金額（数値で「額」を含むキー、または1000以上の数値）
      if (typeof data === 'number' && data >= 1000) {
        return <span className="font-medium">¥{data.toLocaleString()}</span>;
      }
      return <span>{String(data)}</span>;
    }

    // 配列
    if (Array.isArray(data)) {
      if (data.length === 0) return <span className="text-gray-400">なし</span>;
      return (
        <ul className="list-disc ml-5 space-y-1">
          {data.map((item, idx) => (
            <li key={idx}>{renderData(item, depth + 1)}</li>
          ))}
        </ul>
      );
    }

    // オブジェクト
    if (typeof data === 'object') {
      return (
        <div className={depth > 0 ? 'ml-4 mt-2 space-y-2' : 'space-y-2'}>
          {Object.entries(data).map(([key, value]) => (
            <div key={key} className="border-l-2 border-gray-200 pl-3">
              <span className="font-semibold text-gray-700">{key}:</span>{' '}
              <span className="text-gray-900">{renderData(value, depth + 1)}</span>
            </div>
          ))}
        </div>
      );
    }

    return <span>{String(data)}</span>;
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-8 text-center">
          ファクタリング審査ワークフロー
        </h1>

        {/* 入力フォーム */}
        <div className="bg-white rounded-lg shadow p-6 mb-8">
          <div className="flex gap-4">
            <input
              type="text"
              value={recordId}
              onChange={(e) => setRecordId(e.target.value)}
              placeholder="KintoneレコードID（例: 9918）"
              className="flex-1 px-4 py-2 border rounded"
              disabled={isRunning}
            />
            <button
              onClick={startWorkflow}
              disabled={isRunning}
              className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {isRunning ? '実行中...' : 'ワークフロー開始'}
            </button>
          </div>
        </div>

        {/* フェーズ進捗表示 */}
        {phases.length > 0 && (
          <div className="bg-white rounded-lg shadow p-6 mb-8">
            <h2 className="text-xl font-bold mb-4">実行状況</h2>
            <div className="space-y-4">
              {phases.map((phase) => (
                <div
                  key={phase.id}
                  className={`border-l-4 ${getStatusColor(phase.status)} p-4 rounded-r transition-all duration-300`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{getStatusIcon(phase.status)}</span>
                      <div>
                        <div className="font-semibold">{phase.name}</div>
                        {phase.startTime && phase.endTime && (
                          <div className="text-sm text-gray-600">
                            実行時間: {((phase.endTime - phase.startTime) / 1000).toFixed(2)}秒
                          </div>
                        )}
                      </div>
                    </div>
                    {phase.status === 'running' && (
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 処理中の表示（フェーズが1つも表示されていない時） */}
        {isRunning && phases.length === 0 && (
          <div className="bg-white rounded-lg shadow p-8 mb-8 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <div className="text-gray-600">処理を開始しています...</div>
          </div>
        )}

        {/* エラー表示 */}
        {error && (
          <div className="bg-red-50 border-l-4 border-red-500 p-4 mb-8 rounded-r">
            <div className="font-semibold text-red-700 mb-2">❌ エラーが発生しました</div>
            <div className="text-red-600">{error}</div>
          </div>
        )}

        {/* 最終結果表示 */}
        {finalResult && (
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-2xl font-bold mb-6 text-center">🎉 審査結果</h2>

            {/* Phase 4: リスク評価＋総評（新フォーマット） */}
            {finalResult.riskSummaryHtml && (
              <div className="mb-8 border-2 border-blue-300 rounded-lg overflow-hidden shadow-lg">
                <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-4">
                  <h3 className="font-bold text-2xl text-white">📊 リスク評価＋総評</h3>
                </div>
                <div
                  className="bg-white p-8 html-report"
                  dangerouslySetInnerHTML={{ __html: finalResult.riskSummaryHtml }}
                />
              </div>
            )}

            {/* Phase 4: 分析詳細（新フォーマット） */}
            {finalResult.detailedAnalysisHtml && (
              <div className="mb-8 border-2 border-gray-300 rounded-lg overflow-hidden shadow-lg">
                <div className="bg-gradient-to-r from-gray-600 to-gray-700 px-6 py-4">
                  <h3 className="font-bold text-2xl text-white">📋 詳細分析レポート</h3>
                </div>
                <div
                  className="bg-gray-50 p-8 html-report"
                  dangerouslySetInnerHTML={{ __html: finalResult.detailedAnalysisHtml }}
                />
              </div>
            )}

            {/* 旧Phase 4フォーマット（互換性のため残す） */}
            {!finalResult.riskSummary && finalResult.phase4Results?.最終判定 && (
              <div className="mb-6 p-6 bg-gradient-to-r from-blue-50 to-blue-100 rounded-lg border-2 border-blue-300">
                <div className="text-center">
                  <span className="text-lg font-semibold text-gray-700">最終判定: </span>
                  <span className="text-3xl font-bold text-blue-600">
                    {finalResult.phase4Results.最終判定}
                  </span>
                  {finalResult.phase4Results.リスクレベル && (
                    <div className="mt-2 text-gray-600">
                      リスクレベル: {finalResult.phase4Results.リスクレベル}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 総評（旧フォーマット） */}
            {!finalResult.riskSummary && finalResult.phase4Results?.総評 && (
              <div className="mb-6">
                <h3 className="font-bold text-lg mb-3">📝 総評</h3>
                <div className="whitespace-pre-wrap text-sm leading-relaxed bg-gray-50 p-4 rounded">
                  {finalResult.phase4Results.総評}
                </div>
              </div>
            )}

            {/* Phase 4 詳細評価 */}
            <div className="mb-6 space-y-3">
              {/* 回収可能性評価 */}
              {finalResult.phase4Results?.回収可能性評価 && (
                <details className="border rounded-lg p-4 hover:bg-gray-50">
                  <summary className="cursor-pointer font-semibold text-base">💰 回収可能性評価</summary>
                  <div className="mt-3 ml-4 space-y-2 text-sm">
                    {Object.entries(finalResult.phase4Results.回収可能性評価).map(([key, value]) => (
                      <div key={key}>
                        <span className="font-medium">{key}:</span> {String(value)}
                      </div>
                    ))}
                  </div>
                </details>
              )}

              {/* 担保の安定性評価 */}
              {finalResult.phase4Results?.担保の安定性評価 && (
                <details className="border rounded-lg p-4 hover:bg-gray-50">
                  <summary className="cursor-pointer font-semibold text-base">🏠 担保の安定性評価</summary>
                  <div className="mt-3 ml-4 space-y-2 text-sm">
                    {Object.entries(finalResult.phase4Results.担保の安定性評価).map(([key, value]) => (
                      <div key={key}>
                        <span className="font-medium">{key}:</span> {String(value)}
                      </div>
                    ))}
                  </div>
                </details>
              )}

              {/* 申込者信頼性評価 */}
              {finalResult.phase4Results?.申込者信頼性評価 && (
                <details className="border rounded-lg p-4 hover:bg-gray-50">
                  <summary className="cursor-pointer font-semibold text-base">👤 申込者信頼性評価</summary>
                  <div className="mt-3 ml-4 space-y-2 text-sm">
                    {Object.entries(finalResult.phase4Results.申込者信頼性評価).map(([key, value]) => (
                      <div key={key}>
                        <span className="font-medium">{key}:</span> {String(value)}
                      </div>
                    ))}
                  </div>
                </details>
              )}

              {/* リスク要因評価 */}
              {finalResult.phase4Results?.リスク要因評価 && (
                <details className="border rounded-lg p-4 hover:bg-gray-50">
                  <summary className="cursor-pointer font-semibold text-base">⚠️ リスク要因評価</summary>
                  <div className="mt-3 ml-4 space-y-2 text-sm">
                    {Object.entries(finalResult.phase4Results.リスク要因評価).map(([key, value]) => (
                      <div key={key}>
                        <span className="font-medium">{key}:</span> {String(value)}
                      </div>
                    ))}
                  </div>
                </details>
              )}

              {/* 推奨事項 */}
              {finalResult.phase4Results?.推奨事項 && Array.isArray(finalResult.phase4Results.推奨事項) && (
                <details className="border rounded-lg p-4 hover:bg-gray-50">
                  <summary className="cursor-pointer font-semibold text-base">💡 推奨事項</summary>
                  <div className="mt-3 ml-4">
                    <ul className="space-y-3 text-sm">
                      {finalResult.phase4Results.推奨事項.map((item: any, idx: number) => (
                        <li key={idx} className="border-l-2 border-blue-300 pl-3">
                          <div className="font-medium">{item.対応策}</div>
                          <div className="text-gray-600 mt-1">
                            <span className="font-semibold">優先度:</span> {item.優先度} |{' '}
                            <span className="font-semibold">理由:</span> {item.理由}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                </details>
              )}
            </div>

            {/* フェーズ別詳細データ */}
            <details className="mt-6 border-t pt-4">
              <summary className="cursor-pointer font-semibold text-gray-700">📊 フェーズ別詳細データを表示</summary>

              <div className="mt-4 space-y-4">
                {/* Phase 1 */}
                {finalResult.phase1Results && (
                  <details className="border rounded-lg p-4 bg-blue-50">
                    <summary className="cursor-pointer font-semibold">📄 Phase 1: 買取・担保情報処理</summary>
                    <div className="mt-3 ml-4 text-sm space-y-2">
                      {renderData(finalResult.phase1Results)}
                    </div>
                  </details>
                )}

                {/* Phase 2 */}
                {finalResult.phase2Results && (
                  <details className="border rounded-lg p-4 bg-green-50">
                    <summary className="cursor-pointer font-semibold">📊 Phase 2: 通帳分析</summary>
                    <div className="mt-3 ml-4 text-sm space-y-2">
                      {renderData(finalResult.phase2Results)}
                    </div>
                  </details>
                )}

                {/* Phase 3 */}
                {finalResult.phase3Results && (
                  <details className="border rounded-lg p-4 bg-purple-50">
                    <summary className="cursor-pointer font-semibold">🔍 Phase 3: 本人確認・企業実在性確認</summary>
                    <div className="mt-3 ml-4 text-sm space-y-2">
                      {renderData(finalResult.phase3Results)}
                    </div>
                  </details>
                )}
              </div>
            </details>
          </div>
        )}
      </div>
    </div>
  );
}
