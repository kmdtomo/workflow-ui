import { NextRequest } from "next/server";

// ワークフロー実行のプロキシAPIルート（リアルタイムストリーミング版）
export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();
  const apiBaseUrl = process.env.FACTORING_AI_AGENT_URL || 'http://localhost:4111';

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const { recordId } = await req.json();

        if (!recordId) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: "recordId is required" })}\n\n`));
          controller.close();
          return;
        }

        // SSE接続確立
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "start", message: "ワークフロー開始" })}\n\n`));

        console.log('ワークフロー実行開始:', recordId);

        // Step 1: Create Run
        const createRunResponse = await fetch(`${apiBaseUrl}/api/workflows/integratedWorkflow/create-run`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        });

        if (!createRunResponse.ok) {
          const errorText = await createRunResponse.text();
          console.error('Run作成エラー:', errorText);
          throw new Error(`Run作成に失敗しました (${createRunResponse.status}): ${errorText}`);
        }

        const runData = await createRunResponse.json();
        console.log('Run作成完了:', runData);

        // Step 2: リアルタイムストリーミング開始（streamエンドポイント使用）
        console.log('ストリーミング開始 - runId:', runData.runId);
        const streamResponse = await fetch(
          `${apiBaseUrl}/api/workflows/integratedWorkflow/stream?runId=${runData.runId}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              inputData: { recordId }
            }),
          }
        );

        if (!streamResponse.ok) {
          const errorText = await streamResponse.text();
          console.error('ストリーミング開始エラー:', errorText);
          throw new Error(`ストリーミング開始に失敗しました (${streamResponse.status}): ${errorText}`);
        }

        if (!streamResponse.body) {
          throw new Error('ストリームボディが存在しません');
        }

        // Step 3: Mastraからのリアルタイムイベントを受信して転送
        const reader = streamResponse.body.getReader();
        const decoder = new TextDecoder();

        const stepIdToPhase: Record<string, string> = {
          'phase1-purchase-collateral': 'phase1',
          'phase2-bank-statement': 'phase2',
          'phase3-verification': 'phase3',
          'phase4-report-generation': 'phase4',
        };

        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk;

          // JSONオブジェクトを1つずつ抽出
          let braceCount = 0;
          let jsonStart = -1;

          for (let i = 0; i < buffer.length; i++) {
            if (buffer[i] === '{') {
              if (braceCount === 0) jsonStart = i;
              braceCount++;
            } else if (buffer[i] === '}') {
              braceCount--;
              if (braceCount === 0 && jsonStart !== -1) {
                const jsonStr = buffer.substring(jsonStart, i + 1);
                buffer = buffer.substring(i + 1);
                i = -1; // リセット

                try {
                  const event = JSON.parse(jsonStr);
                  console.log('受信イベント:', event.type, event);

                  // Mastraイベントを変換してUIに送信
                  let uiEvent = null;

                  switch (event.type) {
                    case 'start':
                      uiEvent = {
                        type: 'workflow_start',
                        message: 'ワークフロー開始',
                        runId: event.payload?.runId,
                        timestamp: new Date().toISOString()
                      };
                      break;

                    case 'step-start':
                      const phaseIdStart = stepIdToPhase[event.payload?.id] || 'unknown';
                      uiEvent = {
                        type: 'phase_start',
                        phase: phaseIdStart,
                        stepId: event.payload?.id,
                        content: {
                          message: `${event.payload?.id} 開始`
                        }
                      };
                      break;

                    case 'step-result':
                      const phaseIdResult = stepIdToPhase[event.payload?.id] || 'unknown';

                      // ステップが成功した場合
                      if (event.payload?.status === 'success' && event.payload?.result) {
                        uiEvent = {
                          type: 'step_detail',
                          stepId: event.payload?.id,
                          phase: phaseIdResult,
                          status: 'success',
                          output: event.payload?.result,
                          startedAt: event.payload?.startedAt,
                          endedAt: event.payload?.endedAt
                        };
                      }
                      // ステップが失敗した場合
                      else if (event.payload?.status === 'failed') {
                        uiEvent = {
                          type: 'step_error',
                          stepId: event.payload?.id,
                          error: event.payload?.error,
                          message: event.payload?.error || 'ステップ実行エラー'
                        };
                      }
                      break;

                    case 'step-finish':
                      const phaseIdFinish = stepIdToPhase[event.payload?.id] || 'unknown';
                      // Phase完了通知を送信
                      controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                        type: 'phase_complete',
                        phase: phaseIdFinish,
                        stepId: event.payload?.id,
                        content: {
                          message: `${event.payload?.id} 完了`
                        }
                      })}\n\n`));
                      break;

                    case 'finish':
                      // 最終結果を取得
                      const executionResult = await fetch(
                        `${apiBaseUrl}/api/workflows/integratedWorkflow/runs/${event.payload?.runId}/execution-result`,
                        {
                          method: 'GET',
                          headers: { 'Content-Type': 'application/json' }
                        }
                      );

                      if (executionResult.ok) {
                        const result = await executionResult.json();
                        uiEvent = {
                          type: 'complete',
                          result: result.result,
                          status: 'completed'
                        };
                        console.log('ワークフロー完了:', result);
                      } else {
                        uiEvent = {
                          type: 'complete',
                          result: null,
                          status: 'completed'
                        };
                      }
                      break;

                    case 'error':
                      uiEvent = {
                        type: 'error',
                        error: event.payload?.error?.message || 'ワークフローエラー'
                      };
                      break;
                  }

                  // UIイベントをフロントエンドに送信
                  if (uiEvent) {
                    console.log('→ UI送信:', uiEvent.type, uiEvent);
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(uiEvent)}\n\n`));
                  }

                  // ★将来のKintone連携ポイント★
                  // await handleKintoneUpdate(recordId, event);

                } catch (e) {
                  console.log('イベント解析エラー:', e, 'JSONデータ:', jsonStr);
                }
              }
            }
          }
        }

        console.log('ストリーミング完了');

      } catch (error) {
        console.error("Workflow error:", error);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          type: "error",
          error: error instanceof Error ? error.message : "Unknown error"
        })}\n\n`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}

// ★将来追加するKintone連携関数（今は実装しない）
/*
async function handleKintoneUpdate(recordId: string, event: any) {
  // workflow-finish イベントで最終結果をKintoneに書き込み
  if (event.type === 'workflow-finish') {
    const result = event.payload?.workflowState?.result;

    await kintone.record.updateRecord({
      app: KINTONE_APP_ID,
      id: recordId,
      record: {
        '最終判定': { value: result?.最終判定 || '' },
        '総評': { value: result?.phase4Results?.総評 || '' },
        'Phase1結果': { value: JSON.stringify(result?.phase1Results) },
        'Phase2結果': { value: JSON.stringify(result?.phase2Results) },
        'Phase3結果': { value: JSON.stringify(result?.phase3Results) },
        'Phase4結果': { value: JSON.stringify(result?.phase4Results) },
        // ... その他のフィールド
      }
    });
  }
}
*/