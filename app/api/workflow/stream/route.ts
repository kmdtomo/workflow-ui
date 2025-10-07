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
          'parallel-phase123-step': 'parallel-phase123-step',
          'phase4-report-generation': 'phase4-report-generation',
          // 下位互換性のため残す
          'phase1-purchase-collateral': 'phase1',
          'phase2-bank-statement': 'phase2',
          'phase3-verification': 'phase3',
          'phase4': 'phase4',
        };

        let buffer = '';
        let finalWorkflowResult: any = null; // Phase 4の結果を保存

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
                  
                  // step-resultの詳細デバッグ
                  if (event.type === 'step-result') {
                    console.log('🔍 [DEBUG] step-result 詳細:');
                    console.log('  - payload.id:', event.payload?.id);
                    console.log('  - payload.status:', event.payload?.status);
                    console.log('  - payload.output exists:', !!event.payload?.output);
                    if (event.payload?.output) {
                      console.log('  - output keys:', Object.keys(event.payload.output));
                    }
                  }

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
                      if (event.payload?.status === 'success' && event.payload?.output) {
                        // Phase 4 の結果を保存
                        if (event.payload?.id === 'phase4-report-generation') {
                          finalWorkflowResult = event.payload?.output;
                          console.log('💾 Phase 4 結果を保存:', {
                            hasRiskSummaryHtml: !!finalWorkflowResult?.riskSummaryHtml,
                            hasDetailedAnalysisHtml: !!finalWorkflowResult?.detailedAnalysisHtml,
                            keys: Object.keys(finalWorkflowResult || {})
                          });
                        }
                        
                        uiEvent = {
                          type: 'step_detail',
                          stepId: event.payload?.id,
                          phase: phaseIdResult,
                          status: 'success',
                          output: event.payload?.output,
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
                      // 保存したPhase 4の結果を使用
                      if (finalWorkflowResult) {
                        console.log('✅ 保存されたPhase 4結果を使用');
                        console.log('🔍 finalWorkflowResult keys:', Object.keys(finalWorkflowResult));
                        console.log('🔍 riskSummaryHtml 存在:', !!finalWorkflowResult?.riskSummaryHtml);
                        console.log('🔍 riskSummaryHtml 長さ:', finalWorkflowResult?.riskSummaryHtml?.length);
                        console.log('🔍 detailedAnalysisHtml 存在:', !!finalWorkflowResult?.detailedAnalysisHtml);
                        console.log('🔍 detailedAnalysisHtml 長さ:', finalWorkflowResult?.detailedAnalysisHtml?.length);
                        
                        uiEvent = {
                          type: 'complete',
                          result: finalWorkflowResult,
                          status: 'completed'
                        };
                        console.log('ワークフロー完了 - UI送信データ:', uiEvent.type);
                      } else {
                        console.warn('⚠️ Phase 4の結果が保存されていません');
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