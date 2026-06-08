{{- define "studio.name" -}}
{{ .Chart.Name }}
{{- end -}}

{{- define "studio.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{ .Values.fullnameOverride }}
{{- else -}}
{{ .Release.Name }}-{{ include "studio.name" . }}
{{- end -}}
{{- end -}}

{{- define "studio.labels" -}}
app.kubernetes.io/name: {{ include "studio.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end -}}

{{- define "studio.selectorLabels" -}}
app.kubernetes.io/name: {{ include "studio.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "studio.bindingSecretName" -}}
{{- if and .Values.serviceOperator.enabled (not .Values.serviceOperator.existingSecretName) -}}
{{ .Release.Name }}-{{ .Values.serviceOperator.bindingName }}
{{- else -}}
{{ .Values.serviceOperator.existingSecretName }}
{{- end -}}
{{- end -}}
