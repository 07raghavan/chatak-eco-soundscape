import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getRecordings, getRecordingById } from '@/lib/api';
import { BottomNavigation } from '@/components/BottomNavigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertCircle } from 'lucide-react';
import AEDAnalysisDemo from '@/components/AEDAnalysisDemo';

export default function AEDPage() {
  const { recordingId: recordingIdParam } = useParams();
  const navigate = useNavigate();
  const [recordingId, setRecordingId] = useState<number | null>(recordingIdParam ? parseInt(recordingIdParam) : null);
  const [recordings, setRecordings] = useState<any[]>([]);
  const [currentRecording, setCurrentRecording] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [projectIdInPath, setProjectIdInPath] = useState<string | undefined>(undefined);

  // Load list of recordings:
  // 1) If we have projectId in URL, load its recordings.
  // 2) If we have recordingId, load that recording to infer project_id and then load project recordings.
  useEffect(() => {
    (async () => {
      try {
        const match = window.location.pathname.match(/\/projects\/(\d+)/);
        if (match) {
          const projectId = match[1];
          setProjectIdInPath(projectId);
          const list = await getRecordings(projectId);
          setRecordings(list);
          if (!recordingId && list.length > 0) setRecordingId(list[0].id);
          return;
        }

        if (recordingId) {
          const rec = await getRecordingById(recordingId);
          setCurrentRecording(rec);
          // Ensure the selector has at least the current recording
          setRecordings(prev => (prev.length ? prev : [rec]));
          if (rec.project_id) {
            try {
              const list = await getRecordings(String(rec.project_id));
              setRecordings(list);
              setProjectIdInPath(String(rec.project_id));
            } catch (_) {}
          }
        }
      } catch (_) {
        // ignore
      }
    })();
  }, [recordingId]);


  const onPickRecording = async (id: number) => {
    setRecordingId(id);
    navigate(`/recordings/${id}/aed`);
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Acoustic Event Detection</h1>
      </div>

      {/* Recording Selector - Always visible */}
      <Card>
        <CardHeader>
          <CardTitle>Select Recording</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-sm text-gray-500">Loading recordings...</div>
          ) : recordings.length > 0 ? (
            <Select
              value={recordingId?.toString() || ""}
              onValueChange={(value) => onPickRecording(parseInt(value))}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a recording" />
              </SelectTrigger>
              <SelectContent>
                {recordings.map(r => (
                  <SelectItem key={r.id} value={r.id.toString()}>
                    {r.name || `Recording ${r.id}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : currentRecording ? (
            <Select
              value={recordingId?.toString() || ""}
              onValueChange={(value) => onPickRecording(parseInt(value))}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a recording" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={currentRecording.id.toString()}>
                  {currentRecording.name || `Recording ${currentRecording.id}`}
                </SelectItem>
              </SelectContent>
            </Select>
          ) : (
            <Alert>
              <AlertCircle className="w-4 h-4" />
              <AlertDescription>
                No recordings found. Please navigate via a project page or use a direct
                <code className="mx-1">/recordings/:id/aed</code> URL.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* AED Analysis Content - Show when recording is selected */}
      {recordingId && (
        <AEDAnalysisDemo recordingId={recordingId} recordings={recordings} onRecordingChange={onPickRecording} />
      )}
      
      <div className="pb-20" />
      <BottomNavigation projectId={projectIdInPath} />
    </div>
  );
}


