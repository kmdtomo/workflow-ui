import { NextRequest } from "next/server";

// ワークフロー実行のプロキシAPIルート
export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();
  
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

        // Phase 1A開始
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
          type: "phase_start", 
          phase: "phase1a",
          content: { message: "Phase 1A: 重い画像OCR処理開始" }
        })}\n\n`));

        // MastraサーバーのHTTP APIを使用（正しいエンドポイント）
        console.log('ワークフロー実行開始:', recordId);
        
        // Step 1: Create Run
        const createRunResponse = await fetch('http://localhost:4111/api/workflows/agentBasedComplianceWorkflow/create-run', {
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

        // Step 2: Start workflow (非同期で実行)
        console.log('ワークフロー開始 - runId:', runData.runId);
        const startResponse = await fetch(`http://localhost:4111/api/workflows/agentBasedComplianceWorkflow/start-async?runId=${runData.runId}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ 
            inputData: { recordId }
          }),
        });
        
        console.log('開始レスポンスステータス:', startResponse.status);
        
        if (!startResponse.ok) {
          const errorText = await startResponse.text();
          console.error('ワークフロー開始エラー:', errorText);
          throw new Error(`ワークフロー開始に失敗しました (${startResponse.status}): ${errorText}`);
        }

        // 進捗の疑似表示（実際の処理はバックグラウンドで実行）
        const phases = [
          { id: "phase1a", message: "Phase 1A: 重い画像OCR処理" },
          { id: "phase1b", message: "Phase 1B: 軽量OCR処理" },
          { id: "phase2", message: "Phase 2: 外部調査" },
          { id: "phase3", message: "Phase 3: 最終分析" }
        ];
        
        let workflowResult = null;
        let phaseIndex = 0;
        const checkInterval = 5000; // 5秒ごとにチェック
        const maxWaitTime = 180000; // 最大3分待機
        let elapsedTime = 0;
        const sentSteps = new Set<string>(); // 送信済みステップを追跡
        
        // 定期的にワークフローの状態をチェック
        while (!workflowResult && elapsedTime < maxWaitTime) {
          // 進捗表示を更新
          if (phaseIndex < phases.length) {
            const phase = phases[phaseIndex];
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
              type: "phase_start", 
              phase: phase.id,
              content: { message: `${phase.message}開始` }
            })}\n\n`));
          }
          
          // 実行結果をチェック
          const resultResponse = await fetch(`http://localhost:4111/api/workflows/agentBasedComplianceWorkflow/runs/${runData.runId}/execution-result`, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
            },
          });
          
          if (resultResponse.ok) {
            try {
              const result = await resultResponse.json();
              console.log('実行状態確認:', result);
              
              // 各ステップの詳細な結果を送信（重複を避ける）
              if (result.steps) {
                for (const [stepId, stepData] of Object.entries(result.steps)) {
                  // 既に送信済みのステップはスキップ
                  const stepKey = `${stepId}-${stepData.status}`;
                  if (sentSteps.has(stepKey)) continue;
                  
                  if (stepData.status === 'success' && stepData.output) {
                    // ステップ完了時の詳細な出力を送信
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
                      type: "step_detail", 
                      stepId: stepId,
                      status: stepData.status,
                      output: stepData.output,
                      startedAt: stepData.startedAt,
                      endedAt: stepData.endedAt
                    })}\n\n`));
                    sentSteps.add(stepKey); // 送信済みとしてマーク
                  } else if (stepData.status === 'failed') {
                    // エラーの詳細も送信
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
                      type: "step_error", 
                      stepId: stepId,
                      error: stepData.error,
                      startedAt: stepData.startedAt,
                      endedAt: stepData.endedAt
                    })}\n\n`));
                    sentSteps.add(stepKey); // 送信済みとしてマーク
                  }
                }
              }
              
              // 実行が完了していればループを抜ける
              if (result && (result.finalReport || result.status === 'completed' || result.status === 'failed')) {
                workflowResult = result;
                break;
              }
            } catch (e) {
              console.log('結果解析エラー:', e);
            }
          }
          
          // 進捗表示を更新
          if (phaseIndex < phases.length) {
            const phase = phases[phaseIndex];
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
              type: "phase_complete", 
              phase: phase.id,
              content: { message: `${phase.message}完了` }
            })}\n\n`));
            phaseIndex++;
          }
          
          // 待機
          await new Promise(resolve => setTimeout(resolve, checkInterval));
          elapsedTime += checkInterval;
        }

        console.log('ワークフロー実行完了:', workflowResult);
        
        // ワークフローが完了したら、実行結果を取得
        if (!workflowResult) {
          console.log('ストリーミングから結果が取得できなかったため、APIから取得します');
          
          // 実行結果を直接取得
          const resultResponse = await fetch(`http://localhost:4111/api/workflows/agentBasedComplianceWorkflow/runs/${runData.runId}/execution-result`, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
            },
          });
          
          if (resultResponse.ok) {
            workflowResult = await resultResponse.json();
            console.log('実行結果取得成功:', workflowResult);
          } else {
            console.error('実行結果取得失敗:', resultResponse.status);
          }
        }
        
        // 最終結果を送信
        if (workflowResult?.finalReport || workflowResult?.result?.finalReport) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
            type: "complete", 
            result: {
              finalReport: workflowResult.finalReport || workflowResult.result?.finalReport || workflowResult.executionResult?.finalReport,
              recommendation: workflowResult.recommendation || workflowResult.result?.recommendation || workflowResult.executionResult?.recommendation,
              executionResult: workflowResult
            }
          })}\n\n`));
        } else {
          // フォールバック：完了メッセージ
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
            type: "complete", 
            result: { 
              finalReport: `レコードID ${recordId} の処理が完了しました。\n\n詳細な結果は取得できませんでした。`,
              recommendation: "結果取得エラー",
              debug: workflowResult
            }
          })}\n\n`));
        }
        
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