FROM python:3.12-slim
WORKDIR /srv/pipeline
COPY app ./app
RUN useradd --uid 10001 --create-home studio && mkdir -p /data && chown -R studio:studio /data /srv/pipeline
ENV STUDIO_DATA=/data
USER studio
EXPOSE 8765
CMD ["python", "app/server.py", "--host", "0.0.0.0", "--port", "8765"]
