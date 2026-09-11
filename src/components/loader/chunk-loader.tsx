import './chunk-loader.scss';

export default function ChunkLoader({ message }: { message: string }) {
    return (
        <div className='chunk-loader'>
            <div className='chunk-loader-bg'>
                <div className='chunk-loader-grid' />
            </div>
            <div className='chunk-loader-content'>
                <div className='chunk-loader-logo'>
                    <div className='chunk-ring chunk-ring-1' />
                    <div className='chunk-ring chunk-ring-2' />
                    <div className='chunk-core'>
                        <svg viewBox='0 0 100 100' className='chunk-icon'>
                            <polygon points='50,15 85,75 15,75' fill='none' stroke='currentColor' strokeWidth='2' />
                            <circle cx='50' cy='50' r='6' fill='currentColor' />
                        </svg>
                    </div>
                </div>
                <h2 className='chunk-title'>DONNEHUNTER</h2>
                <div className='chunk-bar'>
                    <div className='chunk-bar-fill' />
                </div>
                <p className='chunk-message'>{message}</p>
            </div>
        </div>
    );
}
