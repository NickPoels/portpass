import { prisma } from '@/lib/prisma';

const RATE_LIMIT_DELAY_MS = 2000; // 2 seconds between API calls
const MAX_CONCURRENT_JOBS = 2;

interface ProcessingContext {
  clusterId?: string;
  onProgress?: (jobId: string, progress: number, message: string) => void;
}

let processingQueue: string[] = [];
let isProcessing = false;
let activeJobs = 0;

/**
 * Process a port research job
 */
async function processPortResearchJob(jobId: string, context?: ProcessingContext): Promise<void> {
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/5344819b-59db-4d2d-a016-3222c2babd5c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'research-processor.ts:18',message:'processPortResearchJob entry',data:{jobId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion
  const job = await prisma.researchJob.findUnique({
    where: { id: jobId }
  });

  if (!job) {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/5344819b-59db-4d2d-a016-3222c2babd5c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'research-processor.ts:24',message:'Job not found',data:{jobId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    console.error(`Job ${jobId} not found`);
    return;
  }

  if (job.status !== 'pending' && job.status !== 'running') {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/5344819b-59db-4d2d-a016-3222c2babd5c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'research-processor.ts:29',message:'Job status check',data:{jobId,status:job.status},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    console.log(`Job ${jobId} is not pending or running (status: ${job.status}), skipping`);
    return;
  }

  await prisma.researchJob.update({
    where: { id: jobId },
    data: { 
      status: 'running',
      startedAt: new Date(),
      progress: 0,
      lastHeartbeat: new Date()
    }
  });

  // Start heartbeat interval - update every 30 seconds
  const heartbeatInterval = setInterval(async () => {
    await prisma.researchJob.update({
      where: { id: jobId },
      data: { lastHeartbeat: new Date() }
    }).catch(() => {}); // Fail silently to not block processing
  }, 30000); // 30 seconds

  try {
    console.log(`[DEBUG] ========== PROCESS PORT RESEARCH JOB ENTRY ==========`);
    console.log(`[DEBUG] Job ID: ${jobId}, Entity ID: ${job.entityId}`);
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/5344819b-59db-4d2d-a016-3222c2babd5c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'research-processor.ts:43',message:'Starting port research job',data:{jobId,entityId:job.entityId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    console.log(`Starting port research job ${jobId} for port ${job.entityId}`);
    context?.onProgress?.(jobId, 10, 'Starting port research...');

    const port = await prisma.port.findUnique({
      where: { id: job.entityId },
      include: { cluster: true, terminals: true }
    });

    if (!port) {
      throw new Error(`Port ${job.entityId} not found`);
    }

    // Call port deep-research endpoint in background mode
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 
                    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 
                    'http://localhost:3000';
    const researchUrl = `${baseUrl}/api/ports/${port.id}/deep-research?background=true`;
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/5344819b-59db-4d2d-a016-3222c2babd5c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'research-processor.ts:61',message:'Before fetch call',data:{jobId,researchUrl},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    console.error(`[DEBUG] ========== RESEARCH PROCESSOR: Calling research endpoint ==========`);
    console.error(`[DEBUG] Research URL: ${researchUrl}`);
    console.error(`[DEBUG] Job ID: ${jobId}`);
    console.log(`[DEBUG] ========== RESEARCH PROCESSOR: Calling research endpoint ==========`);
    console.log(`[DEBUG] Research URL: ${researchUrl}`);
    console.log(`[DEBUG] Job ID: ${jobId}`);
    const fetchStartTime = Date.now();
    
    // Add timeout to fetch (5 minutes max)
    const timeoutMs = 5 * 60 * 1000;
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => {
        console.log(`[DEBUG] ========== FETCH TIMEOUT TRIGGERED after ${timeoutMs}ms ==========`);
        timeoutController.abort();
    }, timeoutMs);
    
    console.log(`[DEBUG] About to call fetch...`);
    const response = await fetch(researchUrl, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'X-Background-Mode': 'true'
      },
      signal: timeoutController.signal,
    });
    clearTimeout(timeoutId);
    console.log(`[DEBUG] ========== FETCH RESPONSE RECEIVED ==========`);
    console.log(`[DEBUG] Response status: ${response.status}, ok: ${response.ok}`);

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/5344819b-59db-4d2d-a016-3222c2babd5c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'research-processor.ts:70',message:'After fetch call',data:{jobId,status:response.status,ok:response.ok,fetchDuration:Date.now()-fetchStartTime},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      console.error(`Research failed for job ${jobId}: ${response.status} ${errorText}`);
      throw new Error(`Research failed: ${response.status} ${errorText}`);
    }
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/5344819b-59db-4d2d-a016-3222c2babd5c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'research-processor.ts:76',message:'Response OK, getting reader',data:{jobId,hasBody:!!response.body},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
    // #endregion
    console.log(`Research endpoint responded for job ${jobId}, reading stream...`);

    // Read the stream to get proposals and progress updates
    const reader = response.body?.getReader();
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/5344819b-59db-4d2d-a016-3222c2babd5c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'research-processor.ts:80',message:'Reader created',data:{jobId,hasReader:!!reader},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
    // #endregion
    const decoder = new TextDecoder();
    let fieldProposals: any[] = [];
    let dataToUpdate: any = {};
    let buffer = '';
    let streamIterations = 0;
    let lastDataReceivedTime = Date.now();
    const STREAM_READ_TIMEOUT_MS = 6 * 60 * 1000; // 6 minutes max per read (slightly longer than endpoint maxDuration)
    const STREAM_TOTAL_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes max total for stream reading
    const streamStartTime = Date.now();

    if (reader) {
      try {
        while (true) {
          streamIterations++;
          const readStartTime = Date.now();
          
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/5344819b-59db-4d2d-a016-3222c2babd5c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'research-processor.ts:120',message:'Before reader.read()',data:{jobId,iteration:streamIterations,timeSinceLastData:readStartTime-lastDataReceivedTime,totalTime:readStartTime-streamStartTime},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
          // #endregion
          
          // Check for total timeout
          if (readStartTime - streamStartTime > STREAM_TOTAL_TIMEOUT_MS) {
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/5344819b-59db-4d2d-a016-3222c2babd5c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'research-processor.ts:125',message:'Stream total timeout detected',data:{jobId,totalTime:readStartTime-streamStartTime},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
            // #endregion
            reader.cancel();
            throw new Error(`Stream reading total timeout: exceeded ${STREAM_TOTAL_TIMEOUT_MS}ms`);
          }
          
          // Race reader.read() against a timeout promise
          const readPromise = reader.read();
          const timeoutPromise = new Promise<{ done: boolean; value: Uint8Array | undefined }>((_, reject) => {
            setTimeout(() => {
              reader.cancel();
              reject(new Error(`Stream read timeout: no data received for ${STREAM_READ_TIMEOUT_MS}ms`));
            }, STREAM_READ_TIMEOUT_MS);
          });
          
          let readResult: { done: boolean; value: Uint8Array | undefined };
          try {
            readResult = await Promise.race([readPromise, timeoutPromise]);
          } catch (timeoutError) {
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/5344819b-59db-4d2d-a016-3222c2babd5c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'research-processor.ts:138',message:'Stream read timeout',data:{jobId,iteration:streamIterations,error:timeoutError instanceof Error?timeoutError.message:String(timeoutError)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
            // #endregion
            throw timeoutError;
          }
          
          const { done, value } = readResult;
          lastDataReceivedTime = Date.now();
          const readDuration = lastDataReceivedTime - readStartTime;
        
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/5344819b-59db-4d2d-a016-3222c2babd5c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'research-processor.ts:145',message:'After reader.read()',data:{jobId,iteration:streamIterations,done,hasValue:!!value,valueLength:value?.length||0,readDuration},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
          // #endregion
          
          if (done) {
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/5344819b-59db-4d2d-a016-3222c2babd5c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'research-processor.ts:150',message:'Stream done=true, breaking loop',data:{jobId,iteration:streamIterations},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
            // #endregion
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          
          // SSE format: event blocks separated by \n\n
          // Each block: event: <type>\ndata: <json>\n\n
          const eventBlocks = buffer.split('\n\n');
          buffer = eventBlocks.pop() || ''; // Keep incomplete block in buffer

          for (const eventBlock of eventBlocks) {
            if (!eventBlock.trim()) continue;
            
            const lines = eventBlock.split('\n');
            let eventType = '';
            let eventData = '';
            
            for (const line of lines) {
              if (line.startsWith('event: ')) {
                eventType = line.substring(7).trim();
              } else if (line.startsWith('data: ')) {
                eventData = line.substring(6).trim();
              }
            }
            
            if (eventData) {
              try {
                const data = JSON.parse(eventData);
                
                // #region agent log
                fetch('http://127.0.0.1:7242/ingest/5344819b-59db-4d2d-a016-3222c2babd5c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'research-processor.ts:163',message:'SSE event received',data:{jobId,eventType,hasProgress:data.progress!==undefined,progress:data.progress},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
                // #endregion
                
                // Handle status events - update progress in database
                if (eventType === 'status' && data.progress !== undefined) {
                  const progress = Math.max(0, Math.min(100, data.progress || 0));
                  
                  // Update job progress in database
                  await prisma.researchJob.update({
                    where: { id: jobId },
                    data: { progress }
                  }).catch(err => {
                    // #region agent log
                    fetch('http://127.0.0.1:7242/ingest/5344819b-59db-4d2d-a016-3222c2babd5c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'research-processor.ts:175',message:'Progress update failed',data:{jobId,error:err.message},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
                    // #endregion
                    console.error(`Failed to update progress for job ${jobId}:`, err);
                  });
                  
                  console.log(`Job ${jobId} progress: ${progress}% - ${data.message || 'Processing...'}`);
                  context?.onProgress?.(jobId, progress, data.message || 'Processing...');
                }
                
                // Handle preview event - contains final results
                if (eventType === 'preview') {
                  fieldProposals = data.field_proposals || [];
                  dataToUpdate = data.data_to_update || {};
                  // #region agent log
                  fetch('http://127.0.0.1:7242/ingest/5344819b-59db-4d2d-a016-3222c2babd5c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'research-processor.ts:185',message:'Preview event received',data:{jobId,proposalCount:fieldProposals.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
                  // #endregion
                  console.log(`Job ${jobId} received preview event with ${fieldProposals.length} proposals`);
                  
                  // MARK JOB COMPLETE IMMEDIATELY - don't wait for stream to close
                  await prisma.researchJob.update({
                    where: { id: jobId },
                    data: {
                      status: 'completed',
                      progress: 100,
                      completedAt: new Date()
                    }
                  }).catch(err => {
                    console.error(`Failed to mark job ${jobId} as completed:`, err);
                  });
                  
                  console.log(`Job ${jobId} marked as completed (preview event received)`);
                  context?.onProgress?.(jobId, 100, 'Research complete. Review changes in the port detail panel.');
                  
                  // Continue reading stream in background for cleanup
                  // Stream will close naturally or timeout
                }
                
                // Handle error events
                if (eventType === 'error') {
                  // #region agent log
                  fetch('http://127.0.0.1:7242/ingest/5344819b-59db-4d2d-a016-3222c2babd5c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'research-processor.ts:192',message:'Error event received',data:{jobId,errorData:data},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
                  // #endregion
                  console.error(`Job ${jobId} received error event:`, data);
                  throw new Error(data.message || 'Research error occurred');
                }
              } catch (e) {
                // Ignore parse errors for individual events, but log them
                if (e instanceof Error && !e.message.includes('JSON')) {
                  // #region agent log
                  fetch('http://127.0.0.1:7242/ingest/5344819b-59db-4d2d-a016-3222c2babd5c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'research-processor.ts:200',message:'Error processing event',data:{jobId,error:e.message},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
                  // #endregion
                  console.error(`Error processing event in job ${jobId}:`, e);
                }
              }
            }
          }
        }
      } catch (streamError) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/5344819b-59db-4d2d-a016-3222c2babd5c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'research-processor.ts:208',message:'Stream reading error',data:{jobId,error:streamError instanceof Error?streamError.message:String(streamError)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
        // #endregion
        // Ensure reader is cancelled on error
        try {
          reader.cancel();
        } catch (cancelError) {
          // Ignore cancel errors
        }
        throw streamError;
      }
    }
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/5344819b-59db-4d2d-a016-3222c2babd5c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'research-processor.ts:172',message:'Stream reading complete',data:{jobId,iterations:streamIterations},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
    // #endregion
    console.log(`Job ${jobId} stream reading complete`);

    // For port research, we don't auto-apply - user reviews in UI
    // The research results are saved to the database by the endpoint
    // Job status is already set to 'completed' when preview event was received
    // If we reach here without a preview event, the job may have failed or timed out

  } catch (error: any) {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/5344819b-59db-4d2d-a016-3222c2babd5c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'research-processor.ts:194',message:'Job processing error',data:{jobId,error:error.message,errorName:error.name,errorStack:error.stack?.substring(0,500)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    console.error(`Job ${jobId} failed:`, error);
    await prisma.researchJob.update({
      where: { id: jobId },
      data: {
        status: 'failed',
        error: error.message || String(error),
        completedAt: new Date()
      }
    });
    throw error;
  } finally {
    // Always clear heartbeat interval
    clearInterval(heartbeatInterval);
  }
}

/**
 * Process a terminal research job
 */
async function processTerminalResearchJob(jobId: string, context?: ProcessingContext): Promise<void> {
  const job = await prisma.researchJob.findUnique({
    where: { id: jobId }
  });

  if (!job) {
    console.error(`Job ${jobId} not found`);
    return;
  }

  if (job.status !== 'pending' && job.status !== 'running') {
    console.log(`Job ${jobId} is not pending or running (status: ${job.status}), skipping`);
    return;
  }

  await prisma.researchJob.update({
    where: { id: jobId },
    data: { 
      status: 'running',
      startedAt: new Date(),
      progress: 0,
      lastHeartbeat: new Date()
    }
  });

  // Start heartbeat interval - update every 30 seconds
  const heartbeatInterval = setInterval(async () => {
    await prisma.researchJob.update({
      where: { id: jobId },
      data: { lastHeartbeat: new Date() }
    }).catch(() => {}); // Fail silently to not block processing
  }, 30000); // 30 seconds

  try {
    console.log(`Starting terminal research job ${jobId} for terminal ${job.entityId}`);
    context?.onProgress?.(jobId, 10, 'Starting terminal research...');

    const terminal = await prisma.terminal.findUnique({
      where: { id: job.entityId },
      include: { port: true }
    });

    if (!terminal) {
      throw new Error(`Terminal ${job.entityId} not found`);
    }

    // Call terminal deep-research endpoint in background mode
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 
                    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 
                    'http://localhost:3000';
    const researchUrl = `${baseUrl}/api/terminals/${terminal.id}/deep-research?background=true`;
    
    console.log(`Calling research endpoint: ${researchUrl}`);
    const response = await fetch(researchUrl, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'X-Background-Mode': 'true'
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      console.error(`Research failed for job ${jobId}: ${response.status} ${errorText}`);
      throw new Error(`Research failed: ${response.status} ${errorText}`);
    }
    
    console.log(`Research endpoint responded for job ${jobId}, reading stream...`);

    // For terminal research, we'll auto-apply high-confidence updates
    // Read the stream to get proposals and progress updates
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let fieldProposals: any[] = [];
    let dataToUpdate: any = {};
    let buffer = '';
    let lastDataReceivedTime = Date.now();
    const STREAM_READ_TIMEOUT_MS = 6 * 60 * 1000; // 6 minutes max per read
    const STREAM_TOTAL_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes max total
    const streamStartTime = Date.now();

    if (reader) {
      try {
        while (true) {
          const readStartTime = Date.now();
          
          // Check for total timeout
          if (readStartTime - streamStartTime > STREAM_TOTAL_TIMEOUT_MS) {
            reader.cancel();
            throw new Error(`Stream reading total timeout: exceeded ${STREAM_TOTAL_TIMEOUT_MS}ms`);
          }
          
          // Race reader.read() against a timeout promise
          const readPromise = reader.read();
          const timeoutPromise = new Promise<{ done: boolean; value: Uint8Array | undefined }>((_, reject) => {
            setTimeout(() => {
              reader.cancel();
              reject(new Error(`Stream read timeout: no data received for ${STREAM_READ_TIMEOUT_MS}ms`));
            }, STREAM_READ_TIMEOUT_MS);
          });
          
          let readResult: { done: boolean; value: Uint8Array | undefined };
          try {
            readResult = await Promise.race([readPromise, timeoutPromise]);
          } catch (timeoutError) {
            throw timeoutError;
          }
          
          const { done, value } = readResult;
          lastDataReceivedTime = Date.now();
          
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          
          // SSE format: event blocks separated by \n\n
          // Each block: event: <type>\ndata: <json>\n\n
          const eventBlocks = buffer.split('\n\n');
          buffer = eventBlocks.pop() || ''; // Keep incomplete block in buffer

          for (const eventBlock of eventBlocks) {
            if (!eventBlock.trim()) continue;
            
            const lines = eventBlock.split('\n');
            let eventType = '';
            let eventData = '';
            
            for (const line of lines) {
              if (line.startsWith('event: ')) {
                eventType = line.substring(7).trim();
              } else if (line.startsWith('data: ')) {
                eventData = line.substring(6).trim();
              }
            }
            
            if (eventData) {
              try {
                const data = JSON.parse(eventData);
                
                // Handle status events - update progress in database
                if (eventType === 'status' && data.progress !== undefined) {
                  const progress = Math.max(0, Math.min(100, data.progress || 0));
                  
                  // Update job progress in database
                  await prisma.researchJob.update({
                    where: { id: jobId },
                    data: { progress }
                  }).catch(err => {
                    console.error(`Failed to update progress for job ${jobId}:`, err);
                  });
                  
                  console.log(`Job ${jobId} progress: ${progress}% - ${data.message || 'Processing...'}`);
                  context?.onProgress?.(jobId, progress, data.message || 'Processing...');
                }
                
                // Handle preview event - contains final results
                if (eventType === 'preview') {
                  fieldProposals = data.field_proposals || [];
                  dataToUpdate = data.data_to_update || {};
                  console.log(`Job ${jobId} received preview event with ${fieldProposals.length} proposals`);
                  
                  // MARK JOB COMPLETE IMMEDIATELY - don't wait for stream to close
                  await prisma.researchJob.update({
                    where: { id: jobId },
                    data: {
                      status: 'completed',
                      progress: 100,
                      completedAt: new Date()
                    }
                  }).catch(err => {
                    console.error(`Failed to mark job ${jobId} as completed:`, err);
                  });
                  
                  console.log(`Job ${jobId} marked as completed (preview event received)`);
                  
                  // Continue reading stream in background for cleanup
                  // Stream will close naturally or timeout
                }
                
                // Handle error events
                if (eventType === 'error') {
                  console.error(`Job ${jobId} received error event:`, data);
                  throw new Error(data.message || 'Research error occurred');
                }
              } catch (e) {
                // Ignore parse errors for individual events, but log them
                if (e instanceof Error && !e.message.includes('JSON')) {
                  console.error(`Error processing event in job ${jobId}:`, e);
                }
              }
            }
          }
        }
      } catch (streamError) {
        // Ensure reader is cancelled on error
        try {
          reader.cancel();
        } catch (cancelError) {
          // Ignore cancel errors
        }
        throw streamError;
      }
    }
    
    console.log(`Job ${jobId} stream reading complete`);

    // Auto-apply high-confidence updates (>0.8)
    // Only if we have proposals (preview event was received)
    if (fieldProposals.length > 0) {
      const approvedFields: string[] = [];
      for (const proposal of fieldProposals) {
        if (proposal.confidence > 0.8 && proposal.shouldUpdate) {
          approvedFields.push(proposal.field);
        }
      }

      if (approvedFields.length > 0) {
        // Apply the updates
        const applyUrl = `${baseUrl}/api/terminals/${terminal.id}/deep-research/apply`;
        const applyResponse = await fetch(applyUrl, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            data_to_update: dataToUpdate,
            approved_fields: approvedFields
          })
        });

        if (!applyResponse.ok) {
          console.warn(`Failed to auto-apply terminal updates: ${applyResponse.statusText}`);
        }
        
        console.log(`Job ${jobId} applied ${approvedFields.length} high-confidence updates`);
        context?.onProgress?.(jobId, 100, `Research complete. Applied ${approvedFields.length} high-confidence updates.`);
      }
    }
    
    // Job status is already set to 'completed' when preview event was received
    // If we reach here without a preview event, the job may have failed or timed out

  } catch (error: any) {
    console.error(`Job ${jobId} failed:`, error);
    await prisma.researchJob.update({
      where: { id: jobId },
      data: {
        status: 'failed',
        error: error.message || String(error),
        completedAt: new Date()
      }
    });
    throw error;
  } finally {
    // Always clear heartbeat interval
    clearInterval(heartbeatInterval);
  }
}

/**
 * Process a single job from the queue
 */
async function processNextJob(context?: ProcessingContext): Promise<void> {
  console.log(`[DEBUG] ========== processNextJob CALLED ==========`);
  console.log(`[DEBUG] Queue length: ${processingQueue.length}, Active jobs: ${activeJobs}, Is processing: ${isProcessing}`);
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/5344819b-59db-4d2d-a016-3222c2babd5c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'research-processor.ts:383',message:'processNextJob entry',data:{queueLength:processingQueue.length,activeJobs,isProcessing},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion
  if (processingQueue.length === 0 || activeJobs >= MAX_CONCURRENT_JOBS) {
    console.log(`[DEBUG] processNextJob early return - queue empty or max jobs reached`);
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/5344819b-59db-4d2d-a016-3222c2babd5c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'research-processor.ts:386',message:'processNextJob early return',data:{queueLength:processingQueue.length,activeJobs,isProcessing},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    return;
  }

  const jobId = processingQueue.shift();
  if (!jobId) return;

  activeJobs++;
  isProcessing = true;

  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/5344819b-59db-4d2d-a016-3222c2babd5c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'research-processor.ts:395',message:'Starting job processing',data:{jobId,activeJobs,queueLength:processingQueue.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion

  try {
    const job = await prisma.researchJob.findUnique({
      where: { id: jobId }
    });

    if (!job) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/5344819b-59db-4d2d-a016-3222c2babd5c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'research-processor.ts:402',message:'Job not found in DB',data:{jobId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      activeJobs--;
      return;
    }

    // Rate limiting delay
    await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY_MS));

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/5344819b-59db-4d2d-a016-3222c2babd5c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'research-processor.ts:410',message:'Before processing job',data:{jobId,jobType:job.type},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion

    if (job.type === 'port') {
      await processPortResearchJob(jobId, context);
    } else if (job.type === 'terminal') {
      await processTerminalResearchJob(jobId, context);
    } else {
      // Unknown job type, mark as failed
      await prisma.researchJob.update({
        where: { id: jobId },
        data: {
          status: 'failed',
          error: `Unknown job type: ${job.type}`,
          completedAt: new Date()
        }
      });
    }

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/5344819b-59db-4d2d-a016-3222c2babd5c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'research-processor.ts:425',message:'Job processing completed',data:{jobId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion

  } catch (error) {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/5344819b-59db-4d2d-a016-3222c2babd5c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'research-processor.ts:429',message:'Job processing error caught',data:{jobId,error:error instanceof Error?error.message:String(error)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    console.error(`Error processing job ${jobId}:`, error);
  } finally {
    activeJobs--;
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/5344819b-59db-4d2d-a016-3222c2babd5c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'research-processor.ts:436',message:'processNextJob finally block',data:{jobId,activeJobs,queueLength:processingQueue.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    
    // Process next job if queue is not empty
    if (processingQueue.length > 0) {
      setImmediate(() => processNextJob(context));
    } else {
      isProcessing = false;
    }
  }
}

/**
 * Clean up stale jobs that are stuck in "running" state
 */
async function cleanupStaleJobs(): Promise<void> {
  const staleThreshold = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes
  
  const staleJobs = await prisma.researchJob.findMany({
    where: {
      status: 'running',
      OR: [
        { lastHeartbeat: { lt: staleThreshold } },
        { lastHeartbeat: null, startedAt: { lt: staleThreshold } }
      ]
    }
  });
  
  if (staleJobs.length > 0) {
    console.log(`Found ${staleJobs.length} stale job(s) to clean up`);
    
    // Mark as failed
    for (const job of staleJobs) {
      await prisma.researchJob.update({
        where: { id: job.id },
        data: {
          status: 'failed',
          error: `Job timeout: no heartbeat for >10 minutes. Started: ${job.startedAt}`,
          completedAt: new Date()
        }
      }).catch(err => {
        console.error(`Failed to mark stale job ${job.id} as failed:`, err);
      });
    }
    
    console.log(`Cleaned up ${staleJobs.length} stale job(s)`);
  }
}

/**
 * Start processing the job queue
 */
export async function processJobQueue(context?: ProcessingContext): Promise<void> {
  console.error(`[DEBUG] ========== processJobQueue CALLED ==========`);
  console.error(`[DEBUG] isProcessing: ${isProcessing}, activeJobs: ${activeJobs}, MAX_CONCURRENT: ${MAX_CONCURRENT_JOBS}`);
  console.log(`[DEBUG] ========== processJobQueue CALLED ==========`);
  console.log(`[DEBUG] isProcessing: ${isProcessing}, activeJobs: ${activeJobs}, MAX_CONCURRENT: ${MAX_CONCURRENT_JOBS}`);
  if (isProcessing && activeJobs >= MAX_CONCURRENT_JOBS) {
    console.log(`[DEBUG] processJobQueue early return - already at max capacity`);
    return; // Already processing at max capacity
  }

  // Cleanup stale jobs first
  console.log(`[DEBUG] Cleaning up stale jobs...`);
  await cleanupStaleJobs().catch(err => {
    console.error('[DEBUG] Error cleaning up stale jobs:', err);
  });

  // Get pending jobs
  console.log(`[DEBUG] Fetching pending jobs from database...`);
  const pendingJobs = await prisma.researchJob.findMany({
    where: { status: 'pending' },
    orderBy: { createdAt: 'asc' },
    take: 10 // Process in batches
  });
  console.log(`[DEBUG] Found ${pendingJobs.length} pending jobs`);

  // Add to queue
  for (const job of pendingJobs) {
    if (!processingQueue.includes(job.id)) {
      processingQueue.push(job.id);
      console.log(`[DEBUG] Added job ${job.id} to queue`);
    }
  }

  // Start processing if not already running
  if (!isProcessing && processingQueue.length > 0) {
    console.log(`[DEBUG] Starting processing - queue length: ${processingQueue.length}`);
    isProcessing = true;
    
    // Process jobs with concurrency limit
    const promises: Promise<void>[] = [];
    const jobsToProcess = Math.min(MAX_CONCURRENT_JOBS, processingQueue.length);
    console.log(`[DEBUG] Processing ${jobsToProcess} jobs concurrently`);
    for (let i = 0; i < jobsToProcess; i++) {
      promises.push(processNextJob(context));
    }
    
    console.log(`[DEBUG] Waiting for ${promises.length} job promises to complete...`);
    await Promise.all(promises);
    console.log(`[DEBUG] All job promises completed`);
  } else {
    console.log(`[DEBUG] Not starting processing - isProcessing: ${isProcessing}, queue length: ${processingQueue.length}`);
  }
}

/**
 * Queue a single port research job
 */
export async function queuePortResearchJob(portId: string, clusterId?: string): Promise<string> {
  const job = await prisma.researchJob.create({
    data: {
      type: 'port',
      entityId: portId,
      clusterId,
      status: 'pending',
      progress: 0
    }
  });
  return job.id;
}

/**
 * Queue port research jobs for multiple ports
 */
export async function queuePortResearchJobs(portIds: string[], clusterId?: string): Promise<string[]> {
  const jobIds: string[] = [];

  for (const portId of portIds) {
    const job = await prisma.researchJob.create({
      data: {
        type: 'port',
        entityId: portId,
        clusterId,
        status: 'pending',
        progress: 0
      }
    });
    jobIds.push(job.id);
  }

  return jobIds;
}

/**
 * Queue a single terminal research job
 */
export async function queueTerminalResearchJob(terminalId: string, clusterId?: string): Promise<string> {
  const job = await prisma.researchJob.create({
    data: {
      type: 'terminal',
      entityId: terminalId,
      clusterId,
      status: 'pending',
      progress: 0
    }
  });
  return job.id;
}

/**
 * Queue terminal research jobs for approved terminals
 */
export async function queueTerminalResearchJobs(terminalIds: string[], clusterId?: string): Promise<string[]> {
  const jobIds: string[] = [];

  for (const terminalId of terminalIds) {
    const job = await prisma.researchJob.create({
      data: {
        type: 'terminal',
        entityId: terminalId,
        clusterId,
        status: 'pending',
        progress: 0
      }
    });
    jobIds.push(job.id);
  }

  return jobIds;
}
